// exports browsers and tests

exports.name = 'Internal';
exports.target_file = 'internal/index.html';
exports.skeleton_file = 'es5/skeleton.html';

exports.browsers = {
  foobar: {
    full: 'Foo Bar 1',
    short: 'foo1',
    obsolete: false
  }
};

exports.tests = [
{
  name: 'always true',
  exec: function () {
    return true;
  },
  res: {
    foobar: true,
  }
},
{
  name: 'always true async',
  exec: function () {
    setTimeout(function () {
      try {
        asyncTestPassed() ;
      } catch (e) { console.log("failed ", e); }
    }, 1);
  },
  res: {
    foobar: true,
  }
},
{
  name: 'async test failed',
  exec: function () {
    setTimeout(function () { asyncTestPassed(); }, 1);
  },
  res: {
    foobar: true,
  }
},
{
  name: 'async does nothing',
  exec: function () {
    setTimeout(function () {}, 1);
  },
  res: {
    foobar: true,
  }
}
];
