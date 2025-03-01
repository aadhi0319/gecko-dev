import WebIDL


def WebIDLTest(parser, harness):
    parser.parse(
        """
        interface TestMethods {
          undefined basic();
          static undefined basicStatic();
          undefined basicWithSimpleArgs(boolean arg1, byte arg2, unsigned long arg3);
          boolean basicBoolean();
          static boolean basicStaticBoolean();
          boolean basicBooleanWithSimpleArgs(boolean arg1, byte arg2, unsigned long arg3);
          undefined optionalArg(optional byte? arg1, optional sequence<byte> arg2);
          undefined variadicArg(byte?... arg1);
          object getObject();
          undefined setObject(object arg1);
          undefined setAny(any arg1);
          float doFloats(float arg1);
        };
    """
    )

    results = parser.finish()

    harness.ok(True, "TestMethods interface parsed without error.")
    harness.check(len(results), 1, "Should be one production.")
    iface = results[0]
    harness.ok(isinstance(iface, WebIDL.IDLInterface), "Should be an IDLInterface")
    harness.check(
        iface.identifier.QName(), "::TestMethods", "Interface has the right QName"
    )
    harness.check(iface.identifier.name, "TestMethods", "Interface has the right name")
    harness.check(len(iface.members), 12, "Expect 12 members")

    methods = iface.members

    def checkArgument(argument, QName, name, type, optional, variadic):
        harness.ok(isinstance(argument, WebIDL.IDLArgument), "Should be an IDLArgument")
        harness.check(
            argument.identifier.QName(), QName, "Argument has the right QName"
        )
        harness.check(argument.identifier.name, name, "Argument has the right name")
        harness.check(str(argument.type), type, "Argument has the right return type")
        harness.check(
            argument.optional, optional, "Argument has the right optional value"
        )
        harness.check(
            argument.variadic, variadic, "Argument has the right variadic value"
        )

    def checkMethod(
        method,
        QName,
        name,
        signatures,
        static=False,
        getter=False,
        setter=False,
        deleter=False,
        legacycaller=False,
        stringifier=False,
    ):
        harness.ok(isinstance(method, WebIDL.IDLMethod), "Should be an IDLMethod")
        harness.ok(method.isMethod(), "Method is a method")
        harness.ok(not method.isAttr(), "Method is not an attr")
        harness.ok(not method.isConst(), "Method is not a const")
        harness.check(method.identifier.QName(), QName, "Method has the right QName")
        harness.check(method.identifier.name, name, "Method has the right name")
        harness.check(method.isStatic(), static, "Method has the correct static value")
        harness.check(method.isGetter(), getter, "Method has the correct getter value")
        harness.check(method.isSetter(), setter, "Method has the correct setter value")
        harness.check(
            method.isDeleter(), deleter, "Method has the correct deleter value"
        )
        harness.check(
            method.isLegacycaller(),
            legacycaller,
            "Method has the correct legacycaller value",
        )
        harness.check(
            method.isStringifier(),
            stringifier,
            "Method has the correct stringifier value",
        )
        harness.check(
            len(method.signatures()),
            len(signatures),
            "Method has the correct number of signatures",
        )

        sigpairs = zip(method.signatures(), signatures)
        for gotSignature, expectedSignature in sigpairs:
            (gotRetType, gotArgs) = gotSignature
            (expectedRetType, expectedArgs) = expectedSignature

            harness.check(
                str(gotRetType), expectedRetType, "Method has the expected return type."
            )

            for i in range(0, len(gotArgs)):
                (QName, name, type, optional, variadic) = expectedArgs[i]
                checkArgument(gotArgs[i], QName, name, type, optional, variadic)

    checkMethod(methods[0], "::TestMethods::basic", "basic", [("Undefined", [])])
    checkMethod(
        methods[1],
        "::TestMethods::basicStatic",
        "basicStatic",
        [("Undefined", [])],
        static=True,
    )
    checkMethod(
        methods[2],
        "::TestMethods::basicWithSimpleArgs",
        "basicWithSimpleArgs",
        [
            (
                "Undefined",
                [
                    (
                        "::TestMethods::basicWithSimpleArgs::arg1",
                        "arg1",
                        "Boolean",
                        False,
                        False,
                    ),
                    (
                        "::TestMethods::basicWithSimpleArgs::arg2",
                        "arg2",
                        "Byte",
                        False,
                        False,
                    ),
                    (
                        "::TestMethods::basicWithSimpleArgs::arg3",
                        "arg3",
                        "UnsignedLong",
                        False,
                        False,
                    ),
                ],
            )
        ],
    )
    checkMethod(
        methods[3], "::TestMethods::basicBoolean", "basicBoolean", [("Boolean", [])]
    )
    checkMethod(
        methods[4],
        "::TestMethods::basicStaticBoolean",
        "basicStaticBoolean",
        [("Boolean", [])],
        static=True,
    )
    checkMethod(
        methods[5],
        "::TestMethods::basicBooleanWithSimpleArgs",
        "basicBooleanWithSimpleArgs",
        [
            (
                "Boolean",
                [
                    (
                        "::TestMethods::basicBooleanWithSimpleArgs::arg1",
                        "arg1",
                        "Boolean",
                        False,
                        False,
                    ),
                    (
                        "::TestMethods::basicBooleanWithSimpleArgs::arg2",
                        "arg2",
                        "Byte",
                        False,
                        False,
                    ),
                    (
                        "::TestMethods::basicBooleanWithSimpleArgs::arg3",
                        "arg3",
                        "UnsignedLong",
                        False,
                        False,
                    ),
                ],
            )
        ],
    )
    checkMethod(
        methods[6],
        "::TestMethods::optionalArg",
        "optionalArg",
        [
            (
                "Undefined",
                [
                    (
                        "::TestMethods::optionalArg::arg1",
                        "arg1",
                        "ByteOrNull",
                        True,
                        False,
                    ),
                    (
                        "::TestMethods::optionalArg::arg2",
                        "arg2",
                        "ByteSequence",
                        True,
                        False,
                    ),
                ],
            )
        ],
    )
    checkMethod(
        methods[7],
        "::TestMethods::variadicArg",
        "variadicArg",
        [
            (
                "Undefined",
                [
                    (
                        "::TestMethods::variadicArg::arg1",
                        "arg1",
                        "ByteOrNull",
                        True,
                        True,
                    )
                ],
            )
        ],
    )
    checkMethod(methods[8], "::TestMethods::getObject", "getObject", [("Object", [])])
    checkMethod(
        methods[9],
        "::TestMethods::setObject",
        "setObject",
        [
            (
                "Undefined",
                [("::TestMethods::setObject::arg1", "arg1", "Object", False, False)],
            )
        ],
    )
    checkMethod(
        methods[10],
        "::TestMethods::setAny",
        "setAny",
        [("Undefined", [("::TestMethods::setAny::arg1", "arg1", "Any", False, False)])],
    )
    checkMethod(
        methods[11],
        "::TestMethods::doFloats",
        "doFloats",
        [("Float", [("::TestMethods::doFloats::arg1", "arg1", "Float", False, False)])],
    )

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            undefined foo(optional float bar = 1);
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(not threw, "Should allow integer to float type corecion")

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            [GetterThrows] undefined foo();
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(threw, "Should not allow [GetterThrows] on methods")

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            [SetterThrows] undefined foo();
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(threw, "Should not allow [SetterThrows] on methods")

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            [Throw] undefined foo();
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(threw, "Should spell [Throws] correctly on methods")

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            undefined __noSuchMethod__();
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(threw, "Should not allow __noSuchMethod__ methods")

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            [Throws, LenientFloat]
            undefined foo(float myFloat);
            [Throws]
            undefined foo();
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(not threw, "Should allow LenientFloat to be only in a specific overload")

    parser = parser.reset()
    parser.parse(
        """
      interface A {
        [Throws]
        undefined foo();
        [Throws, LenientFloat]
        undefined foo(float myFloat);
      };
    """
    )
    results = parser.finish()
    iface = results[0]
    methods = iface.members
    lenientFloat = methods[0].getExtendedAttribute("LenientFloat")
    harness.ok(
        lenientFloat is not None,
        "LenientFloat in overloads must be added to the method",
    )

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            [Throws, LenientFloat]
            undefined foo(float myFloat);
            [Throws]
            undefined foo(float myFloat, float yourFloat);
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(
        threw,
        "Should prevent overloads from getting different restricted float behavior",
    )

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            [Throws]
            undefined foo(float myFloat, float yourFloat);
            [Throws, LenientFloat]
            undefined foo(float myFloat);
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(
        threw,
        "Should prevent overloads from getting different restricted float behavior (2)",
    )

    parser = parser.reset()
    threw = False
    try:
        parser.parse(
            """
          interface A {
            [Throws, LenientFloat]
            undefined foo(float myFloat);
            [Throws, LenientFloat]
            undefined foo(short myShort);
          };
        """
        )
        results = parser.finish()
    except Exception:
        threw = True
    harness.ok(threw, "Should prevent overloads from getting redundant [LenientFloat]")
