const jwt = require("jsonwebtoken");

module.exports.generate = function () {
  return jwt.sign(
    {
      loggedIn: true,
    },
    process.env.SECRET,
    {
      expiresIn: "5h",
    }
  );
};

module.exports.verify = function (token) {
  try {
    return jwt.verify(token, process.env.SECRET);
  } catch (error) {
    return false;
  }
};
