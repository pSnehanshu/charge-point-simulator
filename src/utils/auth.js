const token = require("./token");

module.exports = function (tokenName = "token") {
  return function (req, res, next) {
    if (req.cookies[tokenName]) {
      if (token.verify(req.cookies[tokenName])) {
        return next();
      }
    }

    res.render("login", {
      message: "Enter password to continue...",
      color: "orange",
      next: req.originalUrl,
    });
  };
};
