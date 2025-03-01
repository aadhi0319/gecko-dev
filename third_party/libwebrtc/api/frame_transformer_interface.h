/*
 *  Copyright 2020 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree. An additional intellectual property rights grant can be found
 *  in the file PATENTS.  All contributing project authors may
 *  be found in the AUTHORS file in the root of the source tree.
 */

#ifndef API_FRAME_TRANSFORMER_INTERFACE_H_
#define API_FRAME_TRANSFORMER_INTERFACE_H_

#include <memory>
#include <vector>

#include "api/scoped_refptr.h"
#include "api/video/encoded_frame.h"
#include "api/video/video_frame_metadata.h"
#include "rtc_base/ref_count.h"

namespace webrtc {

// Owns the frame payload data.
class TransformableFrameInterface {
 public:
  virtual ~TransformableFrameInterface() = default;

  // Returns the frame payload data. The data is valid until the next non-const
  // method call.
  virtual rtc::ArrayView<const uint8_t> GetData() const = 0;

  // Copies `data` into the owned frame payload data.
  virtual void SetData(rtc::ArrayView<const uint8_t> data) = 0;

  virtual uint8_t GetPayloadType() const = 0;
  virtual uint32_t GetSsrc() const = 0;
  virtual uint32_t GetTimestamp() const = 0;
  // TODO(https://bugs.webrtc.org/14878): Change this to pure virtual after it
  // is implemented everywhere.
  virtual absl::optional<Timestamp> GetCaptureTimeIdentifier() const {
    return absl::nullopt;
  }

  enum class Direction {
    kUnknown,
    kReceiver,
    kSender,
  };
  // TODO(crbug.com/1250638): Remove this distinction between receiver and
  // sender frames to allow received frames to be directly re-transmitted on
  // other PeerConnectionss.
  virtual Direction GetDirection() const { return Direction::kUnknown; }
};

class TransformableVideoFrameInterface : public TransformableFrameInterface {
 public:
  virtual ~TransformableVideoFrameInterface() = default;
  virtual bool IsKeyFrame() const = 0;
  virtual const std::string& GetRid() const = 0;

  virtual VideoFrameMetadata Metadata() const = 0;

  virtual void SetMetadata(const VideoFrameMetadata&) = 0;
};

// Extends the TransformableFrameInterface to expose audio-specific information.
class TransformableAudioFrameInterface : public TransformableFrameInterface {
 public:
  virtual ~TransformableAudioFrameInterface() = default;

  virtual void SetRTPTimestamp(uint32_t timestamp) = 0;
  // Exposes the frame header, enabling the interface clients to use the
  // information in the header as needed, for example to compile the list of
  // csrcs.
  // TODO(crbug.com/1453226): Deprecate and remove once callers have migrated to
  // the getters for specific fields.
  virtual const RTPHeader& GetHeader() const = 0;

  virtual rtc::ArrayView<const uint32_t> GetContributingSources() const = 0;

  // TODO(crbug.com/1453226): Change this to pure virtual after it
  // is implemented everywhere.
  virtual const absl::optional<uint16_t> SequenceNumber() const {
    return absl::nullopt;
  }
};

// Objects implement this interface to be notified with the transformed frame.
class TransformedFrameCallback : public rtc::RefCountInterface {
 public:
  virtual void OnTransformedFrame(
      std::unique_ptr<TransformableFrameInterface> frame) = 0;

 protected:
  ~TransformedFrameCallback() override = default;
};

// Transforms encoded frames. The transformed frame is sent in a callback using
// the TransformedFrameCallback interface (see above).
class FrameTransformerInterface : public rtc::RefCountInterface {
 public:
  // Transforms `frame` using the implementing class' processing logic.
  virtual void Transform(
      std::unique_ptr<TransformableFrameInterface> transformable_frame) = 0;

  virtual void RegisterTransformedFrameCallback(
      rtc::scoped_refptr<TransformedFrameCallback>) {}
  virtual void RegisterTransformedFrameSinkCallback(
      rtc::scoped_refptr<TransformedFrameCallback>,
      uint32_t ssrc) {}
  virtual void UnregisterTransformedFrameCallback() {}
  virtual void UnregisterTransformedFrameSinkCallback(uint32_t ssrc) {}

 protected:
  ~FrameTransformerInterface() override = default;
};

}  // namespace webrtc

#endif  // API_FRAME_TRANSFORMER_INTERFACE_H_
