/**
 * Copyright 2019 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Protocol} from 'devtools-protocol';

import {JSHandle} from '../api/JSHandle.js';
import {Realm} from '../api/Realm.js';
import {Deferred} from '../util/Deferred.js';

import {Binding} from './Binding.js';
import {CDPSession} from './Connection.js';
import {ExecutionContext} from './ExecutionContext.js';
import {CDPFrame} from './Frame.js';
import {MAIN_WORLD, PUPPETEER_WORLD} from './IsolatedWorlds.js';
import {TimeoutSettings} from './TimeoutSettings.js';
import {BindingPayload, EvaluateFunc, HandleFor} from './types.js';
import {
  addPageBinding,
  createCdpHandle,
  debugError,
  Mutex,
  withSourcePuppeteerURLIfNone,
} from './util.js';
import {WebWorker} from './WebWorker.js';

/**
 * @public
 */
export interface WaitForSelectorOptions {
  /**
   * Wait for the selected element to be present in DOM and to be visible, i.e.
   * to not have `display: none` or `visibility: hidden` CSS properties.
   *
   * @defaultValue `false`
   */
  visible?: boolean;
  /**
   * Wait for the selected element to not be found in the DOM or to be hidden,
   * i.e. have `display: none` or `visibility: hidden` CSS properties.
   *
   * @defaultValue `false`
   */
  hidden?: boolean;
  /**
   * Maximum time to wait in milliseconds. Pass `0` to disable timeout.
   *
   * The default value can be changed by using {@link Page.setDefaultTimeout}
   *
   * @defaultValue `30_000` (30 seconds)
   */
  timeout?: number;
  /**
   * A signal object that allows you to cancel a waitForSelector call.
   */
  signal?: AbortSignal;
}

/**
 * @internal
 */
export interface PageBinding {
  name: string;
  pptrFunction: Function;
}

/**
 * @internal
 */
export interface IsolatedWorldChart {
  [key: string]: IsolatedWorld;
  [MAIN_WORLD]: IsolatedWorld;
  [PUPPETEER_WORLD]: IsolatedWorld;
}

/**
 * @internal
 */
export class IsolatedWorld extends Realm {
  #context = Deferred.create<ExecutionContext>();

  // Set of bindings that have been registered in the current context.
  #contextBindings = new Set<string>();

  // Contains mapping from functions that should be bound to Puppeteer functions.
  #bindings = new Map<string, Binding>();

  get _bindings(): Map<string, Binding> {
    return this.#bindings;
  }

  readonly #frameOrWorker: CDPFrame | WebWorker;

  constructor(
    frameOrWorker: CDPFrame | WebWorker,
    timeoutSettings: TimeoutSettings
  ) {
    super(timeoutSettings);
    this.#frameOrWorker = frameOrWorker;
    this.frameUpdated();
  }

  get environment(): CDPFrame | WebWorker {
    return this.#frameOrWorker;
  }

  frameUpdated(): void {
    this.client.on('Runtime.bindingCalled', this.#onBindingCalled);
  }

  get client(): CDPSession {
    return this.#frameOrWorker.client;
  }

  clearContext(): void {
    this.#context = Deferred.create();
    if (this.#frameOrWorker instanceof CDPFrame) {
      this.#frameOrWorker.clearDocumentHandle();
    }
  }

  setContext(context: ExecutionContext): void {
    this.#contextBindings.clear();
    this.#context.resolve(context);
    void this.taskManager.rerunAll();
  }

  hasContext(): boolean {
    return this.#context.resolved();
  }

  #executionContext(): Promise<ExecutionContext> {
    if (this.disposed) {
      throw new Error(
        `Execution context is not available in detached frame "${this.environment.url()}" (are you trying to evaluate?)`
      );
    }
    if (this.#context === null) {
      throw new Error(`Execution content promise is missing`);
    }
    return this.#context.valueOrThrow();
  }

  async evaluateHandle<
    Params extends unknown[],
    Func extends EvaluateFunc<Params> = EvaluateFunc<Params>,
  >(
    pageFunction: Func | string,
    ...args: Params
  ): Promise<HandleFor<Awaited<ReturnType<Func>>>> {
    pageFunction = withSourcePuppeteerURLIfNone(
      this.evaluateHandle.name,
      pageFunction
    );
    const context = await this.#executionContext();
    return await context.evaluateHandle(pageFunction, ...args);
  }

  async evaluate<
    Params extends unknown[],
    Func extends EvaluateFunc<Params> = EvaluateFunc<Params>,
  >(
    pageFunction: Func | string,
    ...args: Params
  ): Promise<Awaited<ReturnType<Func>>> {
    pageFunction = withSourcePuppeteerURLIfNone(
      this.evaluate.name,
      pageFunction
    );
    const context = await this.#executionContext();
    return await context.evaluate(pageFunction, ...args);
  }

  // If multiple waitFor are set up asynchronously, we need to wait for the
  // first one to set up the binding in the page before running the others.
  #mutex = new Mutex();
  async _addBindingToContext(
    context: ExecutionContext,
    name: string
  ): Promise<void> {
    if (this.#contextBindings.has(name)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _ = await this.#mutex.acquire();
    try {
      await context._client.send(
        'Runtime.addBinding',
        context._contextName
          ? {
              name,
              executionContextName: context._contextName,
            }
          : {
              name,
              executionContextId: context._contextId,
            }
      );

      await context.evaluate(addPageBinding, 'internal', name);

      this.#contextBindings.add(name);
    } catch (error) {
      // We could have tried to evaluate in a context which was already
      // destroyed. This happens, for example, if the page is navigated while
      // we are trying to add the binding
      if (error instanceof Error) {
        // Destroyed context.
        if (error.message.includes('Execution context was destroyed')) {
          return;
        }
        // Missing context.
        if (error.message.includes('Cannot find context with specified id')) {
          return;
        }
      }

      debugError(error);
    }
  }

  #onBindingCalled = async (
    event: Protocol.Runtime.BindingCalledEvent
  ): Promise<void> => {
    let payload: BindingPayload;
    try {
      payload = JSON.parse(event.payload);
    } catch {
      // The binding was either called by something in the page or it was
      // called before our wrapper was initialized.
      return;
    }
    const {type, name, seq, args, isTrivial} = payload;
    if (type !== 'internal') {
      return;
    }
    if (!this.#contextBindings.has(name)) {
      return;
    }

    try {
      const context = await this.#context.valueOrThrow();
      if (event.executionContextId !== context._contextId) {
        return;
      }

      const binding = this._bindings.get(name);
      await binding?.run(context, seq, args, isTrivial);
    } catch (err) {
      debugError(err);
    }
  };

  async adoptBackendNode(
    backendNodeId?: Protocol.DOM.BackendNodeId
  ): Promise<JSHandle<Node>> {
    const executionContext = await this.#executionContext();
    const {object} = await this.client.send('DOM.resolveNode', {
      backendNodeId: backendNodeId,
      executionContextId: executionContext._contextId,
    });
    return createCdpHandle(this, object) as JSHandle<Node>;
  }

  async adoptHandle<T extends JSHandle<Node>>(handle: T): Promise<T> {
    if (handle.realm === this) {
      // If the context has already adopted this handle, clone it so downstream
      // disposal doesn't become an issue.
      return (await handle.evaluateHandle(value => {
        return value;
      })) as unknown as T;
    }
    const nodeInfo = await this.client.send('DOM.describeNode', {
      objectId: handle.id,
    });
    return (await this.adoptBackendNode(nodeInfo.node.backendNodeId)) as T;
  }

  async transferHandle<T extends JSHandle<Node>>(handle: T): Promise<T> {
    if (handle.realm === this) {
      return handle;
    }
    // Implies it's a primitive value, probably.
    if (handle.remoteObject().objectId === undefined) {
      return handle;
    }
    const info = await this.client.send('DOM.describeNode', {
      objectId: handle.remoteObject().objectId,
    });
    const newHandle = (await this.adoptBackendNode(
      info.node.backendNodeId
    )) as T;
    await handle.dispose();
    return newHandle;
  }

  [Symbol.dispose](): void {
    super[Symbol.dispose]();
    this.client.off('Runtime.bindingCalled', this.#onBindingCalled);
  }
}
