const shortid = require('shortid');

class Session {
    constructor(uid, params = {}) {
        // Generate random session id
        this.id = shortid.generate();

        // Params
        this.energy = 5;// in kWh (randomly between 5 to 60)

        var power = 5.6; // in kW (randomly between 3.7 and 11)
        this.duration = this.energy * 60 / power; // in minutes
    }
};

module.exports = Session;
