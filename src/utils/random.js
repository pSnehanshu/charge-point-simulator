module.exports = getRandomNumber;

/**
 * Get a random number between min and max
 * @param {Number} min 
 * @param {Number} max 
 */
function getRandomNumber(min = 0, max = 100) {
    return Math.floor(Math.random() * (max - min) + min);
}
