/* ============================================================
   SpotLED BLE protocol — ported from iwalton3/python-spotled
   (GATT service 0000ff20, cmd char 0000ff21, data char 0000ff22)
   ============================================================ */

export const SERVICE_UUID = '0000ff20-0000-1000-8000-00805f9b34fb';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
export const CMD_CHAR_UUID = '0000ff21-0000-1000-8000-00805f9b34fb';
export const DATA_CHAR_UUID = '0000ff22-0000-1000-8000-00805f9b34fb';

export const Effect = {
  NONE: 0, SCROLL_UP: 1, SCROLL_DOWN: 2, SCROLL_LEFT: 3,
  SCROLL_RIGHT: 4, STACK: 5, EXPAND: 6, LASER: 7,
};

export const ScreenMode = {
  NORMAL: 0, UPSIDE_DOWN: 1, MIRROR: 2, MIRROR_UPSIDE_DOWN: 3,
};

export const ColorDepth = { MONOCHROME: 16, RGB: 255 };

/* ---------- byte-level writer / reader ---------- */

class ByteWriter {
  constructor() { this.bytes = []; this.checksumStart = 0; }
  writeByte(v) { this.bytes.push(v & 255); return this; }
  writeShort(v) { this.bytes.push((v >> 8) & 255, v & 255); return this; }
  writeInt(v) {
    this.bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    return this;
  }
  writeBytes(arr) { for (const b of arr) this.bytes.push(b & 255); return this; }
  startChecksum() { this.checksumStart = this.bytes.length; return this; }
  writeChecksum() {
    let value = 0;
    for (let i = this.checksumStart; i < this.bytes.length; i++) {
      value += 255 & this.bytes[i];
      if (value > 255) value = (~value) + 1;
    }
    this.bytes.push(value & 255);
    return this;
  }
  toBytes() { return new Uint8Array(this.bytes); }
}

class ByteReader {
  constructor(content) { this.content = content; this.pos = 0; }
  readByte() { return this.content[this.pos++]; }
  readShort() {
    const v = (this.content[this.pos] << 8) + this.content[this.pos + 1];
    this.pos += 2; return v;
  }
  readInt() {
    const c = this.content;
    const v = ((c[this.pos] << 24) + (c[this.pos + 1] << 16) + (c[this.pos + 2] << 8) + c[this.pos + 3]) >>> 0;
    this.pos += 4; return v;
  }
  readBytes(n) { const v = this.content.slice(this.pos, this.pos + n); this.pos += n; return v; }
}

/* ---------- control commands (cmd characteristic) ---------- */

export class SendingDataStartCommand {
  constructor(serialNo, commandType, commandLength) {
    Object.assign(this, { serialNo, commandType, commandLength });
  }
  serialize() {
    return new ByteWriter().writeByte(10).writeByte(1)
      .writeShort(this.serialNo).writeShort(this.commandType)
      .writeInt(this.commandLength).toBytes();
  }
}

export class SendingDataFinishCommand {
  constructor(serialNo, commandType, commandLength) {
    Object.assign(this, { serialNo, commandType, commandLength });
  }
  serialize() {
    return new ByteWriter().writeByte(10).writeByte(3)
      .writeShort(this.serialNo).writeShort(this.commandType)
      .writeInt(this.commandLength).toBytes();
  }
}

export class GetDisplayInfoCommand {
  serialize() { return new ByteWriter().writeByte(4).writeByte(18).writeShort(0).toBytes(); }
}
export class GetVersionCommand {
  serialize() { return new ByteWriter().writeByte(4).writeByte(16).writeShort(0).toBytes(); }
}
export class GetBufferSizeCommand {
  serialize() { return new ByteWriter().writeByte(4).writeByte(20).writeShort(0).toBytes(); }
}

/* SendDataCommand wraps any serialized Data item (data characteristic payload) */
export class SendDataCommand {
  constructor(content) { this.serialNo = 1; this.commandType = 32772; this.content = content; }
  serialize() {
    return new ByteWriter()
      .writeInt(15).writeShort(this.commandType).writeInt(this.serialNo)
      .writeInt(this.content.length).writeChecksum().writeBytes(this.content).toBytes();
  }
}

/* ---------- data items (sent as SendDataCommand content) ---------- */

export class BrightnessData {
  constructor(brightness) { this.brightness = brightness; }
  serialize() {
    return new ByteWriter().writeInt(8).writeShort(14).writeByte(this.brightness).writeChecksum().toBytes();
  }
}

export class ScreenModeData {
  constructor(mode) { this.mode = mode; }
  serialize() {
    return new ByteWriter().writeInt(8).writeShort(15).writeByte(this.mode).writeChecksum().toBytes();
  }
}

export class TimeData {
  constructor(time) { this.time = time; }
  serialize() {
    return new ByteWriter().writeInt(10).writeShort(7).writeByte(0).writeShort(this.time).writeChecksum().toBytes();
  }
}

export class SpeedData {
  constructor(speed) { this.speed = speed; }
  serialize() {
    return new ByteWriter().writeInt(8).writeShort(9).writeByte(this.speed).writeChecksum().toBytes();
  }
}

export class EffectData {
  constructor(effect) { this.effect = effect; }
  serialize() {
    return new ByteWriter().writeInt(8).writeShort(8).writeByte(this.effect).writeChecksum().toBytes();
  }
}

export class FrameData {
  static MONO = 1;
  static RGB = 24;
  constructor(width, height, bitmap, depth = 1) {
    Object.assign(this, { width, height, bitmap, depth });
  }
  serialize() {
    return new ByteWriter()
      .writeInt(this.bitmap.length + 12).writeShort(96)
      .writeShort(this.width).writeShort(this.height).writeByte(this.depth)
      .writeBytes(this.bitmap).writeChecksum().toBytes();
  }
}

export class AnimationData {
  constructor(frames, time, speed, effect) {
    Object.assign(this, { frames, time, speed, effect });
  }
  serialize() {
    const d = new ByteWriter().writeInt(9).writeShort(11).writeShort(this.frames.length).writeChecksum();
    for (const f of this.frames) d.writeBytes(f.serialize());
    d.writeBytes(new TimeData(this.time).serialize());
    d.writeBytes(new SpeedData(this.speed).serialize());
    d.writeBytes(new EffectData(this.effect).serialize());
    return d.toBytes();
  }
}

export class NumberBarData {
  constructor(values) { this.values = values; }
  serialize() {
    const d = new ByteWriter().writeInt(this.values.length * 2 + 9).writeShort(10).writeShort(this.values.length);
    for (const v of this.values) d.writeShort(v);
    d.writeChecksum();
    return d.toBytes();
  }
}

/* ---------- bitmap helpers ---------- */

// rows: array of strings made of '.' (off) and trueChar (on, default '1')
export function genBitmap(rows, { minLen = 0, trueChar = '1' } = {}) {
  const out = [];
  for (let row of rows) {
    let text = row;
    const targetMin = minLen % 8 === 0 ? minLen : minLen + (8 - (minLen % 8));
    if (text.length < targetMin) text += '.'.repeat(targetMin - text.length);
    else if (text.length % 8 !== 0) text += '.'.repeat(8 - (text.length % 8));
    for (let i = 0; i < text.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte |= (text[i + b] === trueChar ? 1 : 0) << (7 - b);
      out.push(byte);
    }
  }
  return new Uint8Array(out);
}

// rows: array of strings; colorMap: char -> [c0,c1,c2]
export function genColorBitmap(rows, colorMap) {
  const out = [];
  for (const row of rows) {
    for (const ch of row) {
      const c = colorMap[ch] || [0, 0, 0];
      out.push(c[0], c[1], c[2]);
    }
  }
  return new Uint8Array(out);
}

/* ---------- responses (from cmd characteristic notifications) ---------- */

class GenericCommandResponse {
  constructor(data) {
    const d = new ByteReader(data);
    // NOTE: the original python-spotled library (using Linux BlueZ/gattlib)
    // skips 3 "junk" bytes here before the length field. Real-world testing
    // against actual hardware over Web Bluetooth shows those 3 bytes don't
    // exist in the notification payload at all — the browser's Bluetooth API
    // already hands us just the characteristic's raw value with no extra
    // prefix. Confirmed by comparing actual notification byte-lengths against
    // each response type's expected content size (all off by exactly 3).
    const length = d.readByte();
    this.commandType = d.readByte();
    this.content = d.readBytes(length - 2);
  }
}

export class SendingDataResponse {
  constructor(content) {
    const d = new ByteReader(content);
    this.serialNo = d.readShort();
    this.errorCode = d.readByte();
    this.commandType = d.readShort();
  }
}

export class ContinueSendingResponse {
  constructor(content) {
    const d = new ByteReader(content);
    this.serialNo = d.readShort();
    this.commandType = d.readShort();
    this.continueFrom = d.readInt();
  }
}

export class PauseSendingResponse {
  constructor(content) {
    const d = new ByteReader(content);
    this.serialNo = d.readShort();
    this.commandType = d.readShort();
    this._unknown = d.readByte();
    this.offset = d.readByte();
  }
}

export class DisplayInfoResponse {
  constructor(content) {
    const d = new ByteReader(content);
    d.readBytes(2);
    d.readByte();
    this.width = d.readShort();
    this.height = d.readShort();
    this.colorDepth = d.readByte();
    this.frameLimit = d.readByte();
    this.brightness = d.readByte();
    this.fontInfo = d.readByte();
  }
}

export class VersionResponse {
  constructor(content) {
    const d = new ByteReader(content);
    d.readBytes(2);
    d.readByte();
    this.deviceType = d.readShort();
    this.deviceRevision = d.readInt();
    this.softwareRevision = d.readInt();
  }
}

export class BufferSizeResponse {
  constructor(content) {
    const d = new ByteReader(content);
    d.readBytes(2);
    d.readByte();
    this.bufferSize = d.readInt();
  }
}

export function parseCommandResponse(data) {
  const r = new GenericCommandResponse(data);
  switch (r.commandType) {
    case 2: return new SendingDataResponse(r.content);
    case 4: return new SendingDataResponse(r.content); // this hardware's own "transfer complete" code -- same structure as type 2, confirmed against real device logs (identical serialNo/errorCode/commandType layout), just a different numeric type than the original spec assumed
    case 255: return new ContinueSendingResponse(r.content);
    case 254: return new PauseSendingResponse(r.content);
    case 19: return new DisplayInfoResponse(r.content);
    case 17: return new VersionResponse(r.content);
    case 21: return new BufferSizeResponse(r.content);
    default: return r;
  }
}

/* ============================================================
   LedConnection — manages the GATT session + flow control
   ============================================================ */

const KNOWN_RESPONSE_TYPES = new Set([2, 4, 17, 19, 21, 254, 255]);

export class LedConnection {
  constructor() {
    this.device = null;
    this.server = null;
    this.cmdChar = null;
    this.dataChar = null;
    this.dataSerialNo = 0;
    this.commandSerialNo = 0;
    this.sendSize = 20; // conservative default (ATT_MTU 23 - 3 byte header)
    this.pending = null;
    this.width = 0;
    this.height = 0;
    this.frameLimit = 20;
    this.brightness = 100;
    this.colorDepth = ColorDepth.MONOCHROME;
    this.bufferSize = 512;
    this.onDisconnect = null;
  }

  async connect(acceptAll = false) {
    // SpotLED badges advertise their BLE name as "SpotLED_xxxx" (per the
    // manufacturer's own setup instructions), so by default we filter the
    // picker to just matching devices instead of showing every nearby BLE
    // device. optionalServices is still required regardless — filters only
    // match on what's in the advertisement packet (the name), while GATT
    // service access to the actual SpotLED service (0000ff20...) is granted
    // separately post-connect.
    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID] }
      : {
          filters: [
            { namePrefix: 'SpotLED' },
            { namePrefix: 'SPOTLED' },
            { namePrefix: 'spotled' },
          ],
          optionalServices: [SERVICE_UUID],
        };
    this.device = await navigator.bluetooth.requestDevice(options);
    this.device.addEventListener('gattserverdisconnected', () => {
      if (this.onDisconnect) this.onDisconnect();
    });
    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(SERVICE_UUID);
    this.cmdChar = await service.getCharacteristic(CMD_CHAR_UUID);
    this.dataChar = await service.getCharacteristic(DATA_CHAR_UUID);
    await this.cmdChar.startNotifications();
    this.cmdChar.addEventListener('characteristicvaluechanged', (ev) => {
      const dv = ev.target.value; // a DataView
      // IMPORTANT: DataView.buffer is the *entire* underlying ArrayBuffer,
      // which is not necessarily tightly sized to this notification's bytes
      // on every platform. Must respect byteOffset/byteLength explicitly or
      // parsing reads garbage/misaligned data.
      const value = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      const commandType = value[1];
      console.debug('[spotled] notification bytes:', JSON.stringify(Array.from(value)),
        '| length_field=', value[0], 'commandType=', commandType);
      // Two sanity checks before treating this as "the response to whatever
      // we're waiting on": the type must be one we recognize, AND the
      // declared length byte must equal the actual packet size (confirmed
      // against real hardware: a genuine response's length byte always
      // equals its total byte count). Either check failing means this is
      // very likely an unsolicited/heartbeat push from the device rather
      // than a real reply, and consuming the pending wait with it would
      // corrupt the whole flow-control state machine.
      if (!KNOWN_RESPONSE_TYPES.has(commandType) || value[0] !== value.length) {
        console.debug('[spotled] ignoring unrecognized/unsolicited notification (type', commandType, ')');
        return;
      }
      if (this.pending) {
        const parsed = parseCommandResponse(value);
        if (!this.pending.predicate || this.pending.predicate(parsed)) {
          const { resolve } = this.pending;
          this.pending = null;
          resolve(value);
        } else {
          // Confirmed against real hardware logs: this device can send a
          // transient "Pause" (type 254) response right after a Finish
          // command, before the actual completion signal arrives slightly
          // later. Accepting the first recognized response unconditionally
          // (the old behavior) grabbed that Pause as if it were the real
          // finish acknowledgment, then stopped listening one message too
          // early -- meaning the genuine completion response arrived after
          // we'd already moved on, and got dropped as "unsolicited". Now we
          // keep waiting until a response actually matches what the caller
          // asked for.
          console.debug('[spotled] response did not match what we\'re waiting for (got',
            parsed.constructor ? parsed.constructor.name : parsed, ') -- still waiting');
        }
      }
    });

    const bufInfo = await this.queryCommand(new GetBufferSizeCommand());
    console.debug('[spotled] GetBufferSizeCommand parsed as:', bufInfo.constructor.name, JSON.stringify(bufInfo));
    this.bufferSize = bufInfo.bufferSize;
    const dispInfo = await this.queryCommand(new GetDisplayInfoCommand());
    console.debug('[spotled] GetDisplayInfoCommand parsed as:', dispInfo.constructor.name, JSON.stringify(dispInfo));
    this.width = dispInfo.width;
    this.height = dispInfo.height;
    this.frameLimit = dispInfo.frameLimit;
    this.brightness = dispInfo.brightness;
    this.colorDepth = dispInfo.colorDepth;

    let version = null;
    try {
      version = await this.queryCommand(new GetVersionCommand());
      console.debug('[spotled] GetVersionCommand parsed as:', version.constructor.name, JSON.stringify(version));
    } catch (e) { console.debug('[spotled] GetVersionCommand failed:', e); }
    this.version = version;
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
  }

  get isConnected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  _nextDataSerialNo() { this.dataSerialNo = (this.dataSerialNo + 1) & 0xffffffff; return this.dataSerialNo; }
  _nextCommandSerialNo() { this.commandSerialNo = (this.commandSerialNo + 1) & 0xffff; return this.commandSerialNo; }

  async _write(characteristic, bytes) {
    // Check the characteristic's actual advertised GATT properties, not just
    // whether the browser API method exists (it always does) — some cheap
    // BLE boards only support "write with response", and calling
    // writeValueWithoutResponse on those throws / silently no-ops on certain
    // Android BLE stacks instead of raising a clear error.
    const props = characteristic.properties || {};
    const label = characteristic.uuid === CMD_CHAR_UUID ? 'cmd' : 'data';
    if (props.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      console.debug(`[spotled] write(${label}, withoutResponse)`, Array.from(bytes));
      await characteristic.writeValueWithoutResponse(bytes);
    } else if (characteristic.writeValueWithResponse) {
      console.debug(`[spotled] write(${label}, withResponse)`, Array.from(bytes));
      await characteristic.writeValueWithResponse(bytes);
    } else {
      console.debug(`[spotled] write(${label}, legacy writeValue)`, Array.from(bytes));
      await characteristic.writeValue(bytes);
    }
  }

  async sendCommand(command) {
    await this._write(this.cmdChar, command.serialize());
  }

  waitForResponse(timeoutMs = 4000, predicate = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('Timeout waiting for device response.'));
      }, timeoutMs);
      this.pending = {
        predicate,
        resolve: (value) => { clearTimeout(timer); resolve(parseCommandResponse(value)); },
      };
    });
  }

  async queryCommand(command, timeoutMs = 4000) {
    const responsePromise = this.waitForResponse(timeoutMs);
    await this.sendCommand(command);
    return responsePromise;
  }

  async sendData(dataCommand) {
    dataCommand.serialNo = this._nextDataSerialNo();
    const serialNo = this._nextCommandSerialNo();
    const payload = dataCommand.serialize();
    console.debug(`[spotled] sendData: type=${dataCommand.commandType} serial=${serialNo} len=${payload.length}`);

    let responsePromise = this.waitForResponse(4000, (resp) =>
      resp instanceof SendingDataResponse && resp.serialNo === serialNo);
    await this.sendCommand(new SendingDataStartCommand(serialNo, dataCommand.commandType, payload.length));
    const startResp = await responsePromise;
    if (startResp.errorCode !== 0) {
      throw new Error(`Device rejected data send (error code ${startResp.errorCode}).`);
    }

    // IMPORTANT: PauseSendingResponse is not a benign transient signal.
    // Per the reference implementation's own documentation: "This response
    // is sent from the device when it has an error reading sent data.
    // Usually this indicates an invalid MTU (your packets are too big or
    // too small)." It carries an `offset` field telling us where to resend
    // from -- functionally the same contract as ContinueSendingResponse's
    // `continueFrom`, just signaling an error condition rather than normal
    // flow control. Treating it as noise to wait past (an earlier version
    // of this fix did exactly that) means the device may never actually
    // receive the data correctly even though the overall exchange appears
    // to "complete" with a final ack.
    let seek = 0;
    let sentPayloads = 0;
    const sendCount = Math.max(1, Math.floor(this.bufferSize / this.sendSize));
    while (seek < payload.length) {
      const chunk = payload.slice(seek, seek + this.sendSize);
      let flowResp = null;
      if (sentPayloads + 1 >= sendCount) {
        const p = this.waitForResponse(4000, (resp) =>
          (resp instanceof ContinueSendingResponse || resp instanceof PauseSendingResponse)
          && resp.serialNo === serialNo);
        await this._write(this.dataChar, chunk);
        flowResp = await p;
      } else {
        await this._write(this.dataChar, chunk);
      }
      sentPayloads++;
      seek += this.sendSize;
      if (flowResp instanceof ContinueSendingResponse) {
        seek = flowResp.continueFrom;
        sentPayloads = 0;
      } else if (flowResp instanceof PauseSendingResponse) {
        console.debug(`[spotled] device signaled a Pause (offset=${flowResp.offset}) -- resending from that offset instead of continuing forward blindly.`);
        seek = flowResp.offset;
        sentPayloads = 0;
      }
      // Small pacing gap between chunk writes -- cheap, conservative
      // insurance regardless of the Pause/offset handling above, since a
      // mid-transfer device reboot was observed once during testing.
      if (seek < payload.length) await sleep(15);
    }

    // Same reasoning: give the device a moment after the last chunk before
    // hitting it with the Finish command.
    await sleep(15);

    // Finish is where we actually observed the device sending Pause in
    // real testing. If that happens, resend the data from the offset it
    // gives us (same handling as the mid-transfer case above) and retry
    // Finish, rather than treating the Pause as if it were the real
    // completion signal.
    const maxFinishAttempts = 5;
    let finishResp = null;
    for (let attempt = 0; attempt < maxFinishAttempts; attempt++) {
      const finishPromise = this.waitForResponse(4000, (resp) =>
        (resp instanceof SendingDataResponse || resp instanceof PauseSendingResponse)
        && resp.serialNo === serialNo);
      await this.sendCommand(new SendingDataFinishCommand(serialNo, dataCommand.commandType, payload.length));
      const resp = await finishPromise;

      if (resp instanceof SendingDataResponse) {
        finishResp = resp;
        break;
      }

      // Got a Pause instead: resend from the offset it specifies, then
      // loop around to retry Finish.
      console.debug(`[spotled] Finish got a Pause (offset=${resp.offset}) -- resending from that offset before retrying Finish.`);
      let resendSeek = resp.offset;
      while (resendSeek < payload.length) {
        const chunk = payload.slice(resendSeek, resendSeek + this.sendSize);
        await this._write(this.dataChar, chunk);
        resendSeek += this.sendSize;
        if (resendSeek < payload.length) await sleep(15);
      }
      await sleep(15);
    }

    if (!finishResp) {
      throw new Error(`Device kept signaling Pause after ${maxFinishAttempts} resend attempts -- giving up rather than looping forever.`);
    }
    if (finishResp.errorCode !== 0) {
      throw new Error(`Device reported an error finishing data send (error code ${finishResp.errorCode}).`);
    }
    console.debug(`[spotled] sendData complete: serial=${serialNo}`);
  }

  async setBrightness(brightness) {
    await this.sendData(new SendDataCommand(new BrightnessData(brightness).serialize()));
    this.brightness = brightness;
  }

  // Diagnostic helper: set a brightness value, then immediately re-query the
  // device's own reported brightness to see whether the write was actually
  // accepted internally by the firmware (independent of whether anything is
  // currently lit up on-screen to visibly dim).
  async setBrightnessAndVerify(brightness) {
    await this.setBrightness(brightness);
    const info = await this.queryCommand(new GetDisplayInfoCommand());
    return info.brightness;
  }

  async setScreenMode(mode) {
    await this.sendData(new SendDataCommand(new ScreenModeData(mode).serialize()));
  }

  async sendFrames(frames, timeMs, speed, effect) {
    if (frames.length > this.frameLimit) {
      throw new Error(`Animation exceeds device frame limit (${this.frameLimit}).`);
    }
    const anim = new AnimationData(frames, timeMs, speed, effect);
    await this.sendData(new SendDataCommand(anim.serialize()));
  }

  async sendNumberBar(values) {
    await this.sendData(new SendDataCommand(new NumberBarData(values).serialize()));
  }
}
