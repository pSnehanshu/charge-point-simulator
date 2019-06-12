const shortid = require('shortid');

class Session {
    constructor(uid, params = {}) {
        // Generate random session id
        this.id = shortid.generate();
        this.uid = uid;

        // Params
        this.energy = params.energy || 5;// in kWh (randomly between 5 to 60)
        this.power = params.power || 5.6; // in kW (randomly between 3.7 and 11)
        this.duration = this.energy * 60 / this.power; // in minutes
        this.start = params.start || new Date;
        this.elapsed = params.elapsed || 0;
    }
};

module.exports = Session;
