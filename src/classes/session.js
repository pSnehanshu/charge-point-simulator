const shortid = require("shortid");
const random = require("../utils/random");

class Session {
  constructor(uid, params = {}) {
    // Generate random session id
    this.id = "sess_" + shortid.generate();
    this.uid = uid;

    // Params
    this.energy = random(params.minEnergy, params.maxEnergy); // in kWh
    this.power = random(params.minPower, params.maxPower); // in kW
    this.start = params.start || new Date();
    this.stop = null;

    // The charging timer
    this.worker = null;

    // Transaction ID to be supplied by Backend
    this.txId = null;

    // Every session is invalid unless accepted
    this.status = "Invalid";

    // An instance of Socket.io io()
    this._io = null;

    // ConnectorId
    this.connectorId = 1;

    // An array of functions to be executed after the session is stopped
    this.afterEnd = [];
  }

  get duration() {
    return (this.energy * 60) / this.power; // in minutes
  }

  get energySpent() {
    let { duration, energy, elapsed } = this;

    if (elapsed >= duration) {
      return energy;
    }

    return (energy / duration) * elapsed;
  }

  get io() {
    if (!this._io) {
      throw new Error("Socket io instance not set yet");
    }
    return this._io;
  }
  set io(io) {
    this._io = io;

    // Setup
    io.on("connection", (socket) => {
      //console.log(`Socket.io connection established`);
    });
  }

  // Time elapsed in minutes
  get elapsed() {
    var now = new Date();
    var elapsed = now - this.start;
    return Math.floor(elapsed / 60000);
  }

  startCharging(onEnd) {
    // Registering the callback
    this.onSessionEnd = onEnd;

    // Displaying session details in client
    this.io.cps_emit("message", JSON.stringify(this.savable(), null, 2));

    this.io.cps_emit(
      "success",
      `Charging ${this.id}. Duration ${Math.round(this.duration)} min.`
    );
    this.worker = setTimeout(() => this.stopCharging(), this.duration * 60000);
  }

  // It will kill the worker and call the startCharging's callback
  async stopCharging() {
    // If a session is already finished, don't try to stop it
    if (this.stop instanceof Date) {
      throw new Error(
        `Session ${
          this.id
        } has already stopped on ${this.stop.toUTCString()}. Can't stop it again.`
      );
    } else {
      clearTimeout(this.worker);
      this.worker = null;
      this.stop = new Date();
      if (typeof this.onSessionEnd == "function") {
        await this.onSessionEnd(this);

        // Executing afterEnd functions
        if (Array.isArray(this.afterEnd)) {
          this.afterEnd.forEach((f) => typeof f == "function" && f(this));
        }
      }
    }
  }

  // returns a savable version of the session
  savable() {
    return {
      txId: this.txId,
      energy: this.energy,
      power: this.power,
      start: this.start,
      uid: this.uid,
      elapsed: this.elapsed,
      duration: this.duration,
      id: this.id,
    };
  }
}

module.exports = Session;
