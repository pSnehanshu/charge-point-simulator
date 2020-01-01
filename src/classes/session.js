const shortid = require('shortid');
const random = require('../utils/random');

class Session {
    constructor(uid, params = {}) {
        // Generate random session id
        this.id = 'sess_' + shortid.generate();
        this.uid = uid;

        // Params
        this.energy = params.energy|| random(params.minEnergy || 5, params.maxEnergy || 60);// in kWh
        this.power  = params.power || random(params.minPower  || 3.7, params.maxPower|| 11); // in kW
        this.start  = params.start || new Date;
        this.stop   = null;

        // The charging timer
        this.worker = null;

        // Transaction ID to be supplied by Backend
        this.txId = null;

        // Every session is invalid unless accepted
        this.status = 'Invalid';

        // An instance of Socket.io io()
        this._io = null;
    }

    get duration() {
        return this.energy * 60 / this.power; // in minutes
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
            throw new Error('Socket io instance not set yet');
        }
        return this._io;
    }
    set io(io) {
        this._io = io;

        // Setup
        io.on('connection', socket => {
            //console.log(`Socket.io connection established`);
        });
    }

    // Time elapsed in minutes
    get elapsed() {
        var now = new Date;
        var elapsed = now - this.start;
        return Math.floor(elapsed / 60000);
    }

    startCharging(onEnd) {
        // Registering the callback
        this.onSessionEnd = onEnd;

        // Displaying session details in client
        this.io.cps_emit('message', JSON.stringify(this.savable(), null, 2));

        this.io.cps_emit('success', `Charging ${this.id}. Duration ${Math.ceil(this.duration)} min.`);
        this.worker = setTimeout(() => this.onSessionEnd(this), this.duration * 60000);
    }

    // It will kill the worker and call the startCharging's callback
    stopCharging() {
        // If a session is already finished, don't try to stop it
        if (this.stop instanceof Date) {
            throw new Error(`Session ${this.id} has already stopped on ${this.stop.toUTCString()}. Can't stop it again.`);
        } else {
            clearTimeout(this.worker);
            this.stop = new Date;
            if (typeof this.onSessionEnd == 'function') {
                this.onSessionEnd(this);
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
};

module.exports = Session;
