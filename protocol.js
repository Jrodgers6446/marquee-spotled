/* ============================================================
   SpotLED BLE protocol — ported from iwalton3/python-spotled
   (GATT service 0000ff20, cmd char 0000ff21, data char 0000ff22)
   ============================================================ */

export const SERVICE_UUID = '0000ff20-0000-1000-8000-00805f9b34fb';
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
    d.readBytes(3);
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

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
    this.device.addEventListener('gattserverdisconnected', () => {
      if (this.onDisconnect) this.onDisconnect();
    });
    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(SERVICE_UUID);
    this.cmdChar = await service.getCharacteristic(CMD_CHAR_UUID);
    this.dataChar = await service.getCharacteristic(DATA_CHAR_UUID);
    await this.cmdChar.startNotifications();
    this.cmdChar.addEventListener('characteristicvaluechanged', (ev) => {
      const value = new Uint8Array(ev.target.value.buffer);
      if (this.pending) {
        const { resolve } = this.pending;
        this.pending = null;
        resolve(value);
      }
    });

    const bufInfo = await this.queryCommand(new GetBufferSizeCommand());
    this.bufferSize = bufInfo.bufferSize;
    const dispInfo = await this.queryCommand(new GetDisplayInfoCommand());
    this.width = dispInfo.width;
    this.height = dispInfo.height;
    this.frameLimit = dispInfo.frameLimit;
    this.brightness = dispInfo.brightness;
    this.colorDepth = dispInfo.colorDepth;

    let version = null;
    try { version = await this.queryCommand(new GetVersionCommand()); } catch (e) { /* optional */ }
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
    if (characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(bytes);
    } else {
      await characteristic.writeValueWithResponse(bytes);
    }
  }

  async sendCommand(command) {
    await this._write(this.cmdChar, command.serialize());
  }

  waitForResponse(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('Timeout waiting for device response.'));
      }, timeoutMs);
      this.pending = {
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

    let responsePromise = this.waitForResponse();
    await this.sendCommand(new SendingDataStartCommand(serialNo, dataCommand.commandType, payload.length));
    const startResp = await responsePromise;
    if (!(startResp instanceof SendingDataResponse) || startResp.serialNo !== serialNo) {
      throw new Error('Unexpected response starting data send.');
    }
    if (startResp.errorCode !== 0) {
      throw new Error(`Device rejected data send (error code ${startResp.errorCode}).`);
    }

    let seek = 0;
    let sentPayloads = 0;
    const sendCount = Math.max(1, Math.floor(this.bufferSize / this.sendSize));
    while (seek < payload.length) {
      const chunk = payload.slice(seek, seek + this.sendSize);
      let contResp = null;
      if (sentPayloads + 1 >= sendCount) {
        const p = this.waitForResponse();
        await this._write(this.dataChar, chunk);
        contResp = await p;
      } else {
        await this._write(this.dataChar, chunk);
      }
      sentPayloads++;
      seek += this.sendSize;
      if (contResp) {
        if (!(contResp instanceof ContinueSendingResponse)) {
          throw new Error('Device paused/reset the transfer (payload size mismatch with MTU).');
        }
        seek = contResp.continueFrom;
        sentPayloads = 0;
      }
    }

    const finishPromise = this.waitForResponse();
    await this.sendCommand(new SendingDataFinishCommand(serialNo, dataCommand.commandType, payload.length));
    await finishPromise;
  }

  async setBrightness(brightness) {
    await this.sendData(new SendDataCommand(new BrightnessData(brightness).serialize()));
    this.brightness = brightness;
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
