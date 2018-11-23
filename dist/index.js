"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tls = require("tls");
const xml2js = require("xml2js");
exports.VERSION = "1.0.0";
// for some reason the reported AC temperature is offset by 55C
const CURRENT_TEMP_FUDGE = 55;
const DEFAULT_PORT = 2878;
// TODO: work out which cipher actually works with the MIM-H02 box
const ANY_CIPHER = tls.getCiphers().join(":").toUpperCase();
class LiteEvent {
    constructor() {
        this.handlers = [];
    }
    on(handler) {
        this.handlers.push(handler);
    }
    off(handler) {
        this.handlers = this.handlers.filter(h => h !== handler);
    }
    trigger(data) {
        this.handlers.slice(0).forEach(h => h(data));
    }
    expose() {
        return this;
    }
}
exports.LiteEvent = LiteEvent;
var FanMode;
(function (FanMode) {
    FanMode["On"] = "On";
    FanMode["Off"] = "Off";
    FanMode["Unknown"] = "Unknown";
})(FanMode = exports.FanMode || (exports.FanMode = {}));
var OperationMode;
(function (OperationMode) {
    OperationMode["Auto"] = "Auto";
    OperationMode["Cool"] = "Cool";
    OperationMode["Heat"] = "Heat";
    OperationMode["Dry"] = "Dry";
    OperationMode["Unknown"] = "Unknown";
})(OperationMode = exports.OperationMode || (exports.OperationMode = {}));
var PowerMode;
(function (PowerMode) {
    PowerMode["On"] = "On";
    PowerMode["Off"] = "Off";
    PowerMode["Unknown"] = "Unknown";
})(PowerMode = exports.PowerMode || (exports.PowerMode = {}));
var FanSpeed;
(function (FanSpeed) {
    FanSpeed["Auto"] = "Auto";
    FanSpeed["Low"] = "Low";
    FanSpeed["Mid"] = "Mid";
    FanSpeed["High"] = "High";
    FanSpeed["Turbo"] = "Turbo";
    FanSpeed["Unknown"] = "Unknown";
})(FanSpeed = exports.FanSpeed || (exports.FanSpeed = {}));
class Attr {
}
exports.Attr = Attr;
class DeviceState {
    parseAttrs(attrs) {
        for (let attr of attrs) {
            // console.info(JSON.stringify(attr));
            if (attr.ID == "AC_FUN_TEMPNOW") {
                this.current_temp = Number(attr.Value) - CURRENT_TEMP_FUDGE;
            }
            else if (attr.ID == "AC_FUN_TEMPSET") {
                this.target_temp = Number(attr.Value);
            }
            else if (attr.ID == "AC_FUN_POWER") {
                this.power = attr.Value;
            }
            else if (attr.ID == "AC_FUN_OPMODE") {
                this.operation = attr.Value;
            }
            else if (attr.ID == "AC_FUN_WINDLEVEL") {
                this.fan_speed = attr.Value;
            }
            else if (attr.ID == "AC_FUN_FAN") {
                this.fan = attr.Value;
            }
        }
    }
}
exports.DeviceState = DeviceState;
class Device {
    constructor(duid, group, model) {
        this.duid = duid;
        this.group = group;
        this.model = model;
        this.state = new DeviceState();
    }
}
exports.Device = Device;
class DeviceUpdated {
    constructor(connection, device, atts) {
        this.connection = connection;
        this.device = device;
        this.atts = atts;
    }
}
exports.DeviceUpdated = DeviceUpdated;
class Connection {
    constructor(hostname, port = DEFAULT_PORT) {
        this.onDisconnect = new LiteEvent();
        this.onUpdate = new LiteEvent();
        this.hostname = hostname;
        this.port = port;
        this.incoming = "";
    }
    get Disconnected() { return this.onDisconnect.expose(); }
    get DeviceUpdated() { return this.onUpdate.expose(); }
    disconnect() {
        if (this.stream) {
            // this.stream.disconnect();
            this.stream = undefined;
        }
    }
    log(msg) {
        if (this.debug_log) {
            this.debug_log(msg);
        }
    }
    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.stream = tls.connect({ host: this.hostname, port: this.port, rejectUnauthorized: false, ciphers: ANY_CIPHER });
                let invalidated = false;
                this.stream.on("data", (data) => {
                    this.incoming += data.toString();
                    let eolIndex;
                    while ((eolIndex = this.incoming.indexOf("\n")) >= 0) {
                        const line = this.incoming.slice(0, eolIndex + 1).trim();
                        this.incoming = this.incoming.slice(eolIndex + 1);
                        this.log("RX: " + line);
                        if (line.startsWith("<")) {
                            xml2js.parseString(line, (err, obj) => {
                                if (err) {
                                    if (this.reject_current_request) {
                                        this.reject_current_request(err);
                                    }
                                }
                                else {
                                    if (obj.Update) {
                                        if (!invalidated && obj.Update.$.Type == "InvalidateAccount") {
                                            // we have received the InvalidateAccount update so the unit is ready to talk to us
                                            invalidated = true;
                                            resolve(this);
                                        }
                                        else if (obj.Update.$.Type == "GetToken") {
                                            if (this.resolve_current_request) {
                                                this.resolve_current_request(obj);
                                            }
                                        }
                                        else {
                                            let dev = this.findDevice(obj.Update.Status[0].$.DUID);
                                            if (dev) {
                                                let atts = obj.Update.Status[0].Attr.map((a) => a.$);
                                                dev.state.parseAttrs(atts);
                                                // console.info(JSON.stringify(dev));
                                                this.onUpdate.trigger(new DeviceUpdated(this, dev, atts));
                                            }
                                            else {
                                                console.warn(JSON.stringify(obj));
                                            }
                                        }
                                    }
                                    else if (obj.Response && obj.Response.$.Type != "GetToken") {
                                        if (this.resolve_current_request) {
                                            this.resolve_current_request(obj);
                                        }
                                    }
                                }
                            });
                        }
                    }
                });
                this.stream.on("close", () => this.onDisconnect.trigger(this));
                this.stream.on("error", (error) => console.error(error));
            }
            catch (_a) {
                reject();
            }
        });
    }
    send(req) {
        if (this.debug_log) {
            this.debug_log("REQUEST: " + JSON.stringify(req));
        }
        let builder = new xml2js.Builder({ renderOpts: { pretty: false } });
        let xml = builder.buildObject(req) + "\r\n";
        if (this.debug_log) {
            this.debug_log("TX: " + xml);
        }
        this.stream.write(xml);
        return new Promise((resolve, reject) => {
            this.resolve_current_request = resolve;
            this.reject_current_request = reject;
        });
    }
    getToken() {
        return new Promise((resolve, reject) => {
            let req = {
                "Request": {
                    "$": { "Type": "GetToken" },
                }
            };
            this.send(req).then((obj) => {
                resolve(obj.Update.$.Token);
            });
        });
    }
    login(token) {
        return new Promise((resolve, reject) => {
            let req = {
                "Request": {
                    "$": { "Type": "AuthToken" },
                    "User": { "$": { "Token": token } }
                }
            };
            this.send(req).then((obj) => {
                resolve(obj.Response.$.StartFrom);
            });
        });
    }
    deviceList(start = 1, count = 1, group = "ALL") {
        return new Promise((resolve, reject) => {
            let req = {
                "Request": {
                    "$": {
                        "Type": "DeviceList",
                        "StartNum": start,
                        "Count": count,
                        "GroupID": group
                    }
                }
            };
            this.send(req).then((obj) => {
                this.devices = obj.Response.DeviceList[0].Device.map((dev) => new Device(dev.$.DUID, dev.$.GroupID, dev.$.ModelID));
                resolve(this.devices);
            });
        });
    }
    findDevice(duid) {
        return this.devices.find((dev) => dev.duid == duid);
    }
    deviceState(duid) {
        return new Promise((resolve, reject) => {
            let req = {
                "Request": {
                    "$": {
                        "Type": "DeviceState",
                        "DUID": duid
                    }
                }
            };
            this.send(req).then((obj) => {
                let dev = this.findDevice(obj.Response.DeviceState[0].Device[0].$.DUID);
                if (dev) {
                    let atts = obj.Response.DeviceState[0].Device[0].Attr.map((a) => a.$);
                    dev.state.parseAttrs(atts);
                    this.onUpdate.trigger(new DeviceUpdated(this, dev, atts));
                    resolve(dev);
                }
                else {
                    reject("Unknown device: " + obj.Response.DeviceState[0].Device[0].$.DUID);
                }
            });
        });
    }
    controlDevice(duid, { power, op, target_temp, fan_speed, fan_mode }) {
        return new Promise((resolve, reject) => {
            let attrs = [];
            if (power) {
                attrs.push({ "$": { "ID": "AC_FUN_POWER", "Value": power } });
            }
            if (op) {
                attrs.push({ "$": { "ID": "AC_FUN_OPMODE", "Value": op } });
            }
            if (target_temp) {
                attrs.push({ "$": { "ID": "AC_FUN_TEMPSET", "Value": target_temp } });
            }
            if (fan_speed) {
                attrs.push({ "$": { "ID": "AC_FUN_WINDLEVEL", "Value": fan_speed } });
            }
            if (fan_mode) {
                attrs.push({ "$": { "ID": "AC_FUN_FAN", "Value": fan_mode } });
            }
            let req = {
                "Request": {
                    "$": {
                        "Type": "DeviceControl"
                    },
                    "Control": {
                        "$": {
                            "CommandID": "cmd00000",
                            "DUID": duid
                        },
                        "Attr": attrs
                    }
                }
            };
            this.send(req).then((obj) => {
                resolve(obj);
            });
        });
    }
}
exports.Connection = Connection;
//# sourceMappingURL=index.js.map