

var argv = require("yargs")
    .version(function() {
        return require('./package').version;
      })
    .help("h")
    .alias("h","help")
    .default({ generate:true, run:true, summary: false, fail: false
        , errors:false, indent:false, verbose:false, src: false, sync:true, async:true })
    .boolean(["generate","run","summary","fail","errors", "indent", "verbose", "code"])
    .alias("g","generate")
    .describe("generate", "if true, will generate the test file. Use --no-generate to use run an existing file")
    .alias("r","run")
    .describe("run", "if true, will run the test file and display the results to the console. Use --no-run for generation only")
    .alias("s","summary")
    .describe("summary", "if true, only summary lines for multiple tests are displayed")
    .alias("e","errors")
    .describe("errors", "if true, shows Errors thrown by tests")
    .alias("l","fail")
    .describe("errors", "if true, shows only tests which fail")
    .alias("v","verbose")
    .describe("verbose", "display detailed information")
    .boolean("src")
    .describe("src", "display source code of tests")
    .boolean("sync")
    .describe("sync", "run synchronous tests")
    .boolean("async")
    .describe("async", "run asynchronous tests")
    .describe("f", "target file")
    .alias("f", "file")
    .default("f", "./escheck.js") 
    .boolean("minify")
    .default("minify", false)
    .describe("minify", "if set, will try to minify tests")
    .alias("x", "exclude")
    .describe("x", "test path pattern to exclude, as a RegExp, ")
    .choices("compiler", ["babel"])
    .describe("compiler", "if set, each test source will be compiled separetely before generation")
    .argv;
    
    
var reportOptions = {
  summary:true,
  fail:true,
  errors:true
}
    
var fs         = require('fs');
var chalk      = require('chalk');
var UglifyJS = require('uglify-js');
var highlight = require('console-highlight');

var babel = require('babel-core');

var _ = require('lodash');

var errAsyncTestNotCompleted = new Error("Asynchronous test has not completed");

var dataInternal = require("./data-internal");
var dataES5 = require("./data-es5");
var dataES6 = require("./data-es6");
var dataES7 = require("./data-es7");
var tests = {internal: dataInternal.tests, es5: dataES5.tests, es6 : dataES6.tests, es7: dataES7.tests };

// ------------------- Utilities --------------------


var indents = ["", " ", "  ", "   ", "    ", "     ", "      "];

/** the error message for tests which cannot be run */
var unableMsg = 'Unable to run this test';

/** returns last item of an array */
function last(arr) {
  return arr ? arr[arr.length - 1] : undefined;
}

/** returns an indenting string of count spaces */
function ind(count) {
  return count < indents.length ? indents[count] : indents[indents.length - 1];
}

function indentCode(depth, src) {
  return src.split("\n").join("\n" + ind(depth));
}

function clipString(len, str) {
  if (str == undefined) return str;
  str = str.toString();
  return str.length < len ? str : str.substring(0, len - 3) + "...";
}

function err(msg) { return {ok:false,error:msg}; }


/** a join function which ignores empty elements */
function joinNotEmpty(items, sep) {
  var str ="";
  for (var i= 0; i < items.length; ++i) {
    var item = items[i];
    if (item != null && item != "") {
      if (str.length != 0) str+=sep;
      str+=item;
    }
  }
  return str;
}

// from @megawac here http://stackoverflow.com/questions/25333918/js-deep-map-function
function deepMap(obj, iterator, context) {
    return _.transform(obj, function(result, val, key) {
        result[key] = _.isObject(val) /*&& !_.isDate(val)*/ ?
                            deepMap(val, iterator, context) :
                            iterator.call(context, val, key, obj);
    });
}

// ------------------- Test support functions --------
// Defines the test runtime environment
// These functions are expected to exist in some tests
if (typeof global === 'undefined') {
  var global = this;
}
function __createIterableObject(arr, methods) {
  methods = methods || {};
  if (typeof Symbol !== 'function' || !Symbol.iterator) {
    return {};
  }
  arr.length++;
  var iterator = {
    next: function() {
      return { value: arr.shift(), done: arr.length <= 0 };
    },
    'return': methods['return'],
    'throw': methods['throw']
  };
  var iterable = {};
  iterable[Symbol.iterator] = function(){ return iterator; }
  return iterable;
}
global.__createIterableObject = __createIterableObject;


function makeTestPassedCallback(path, ioReport) {
  return function (res) {
    ioReport.asyncPending--;
    _.set(ioReport.results, path, res || true);
  }
}
global.makeTestPassedCallback = makeTestPassedCallback;


function runTestAsync(testPath, test, ioReport) {
    if (typeof test === "function") {
      // it's a final test. Let's run it
      if (isAsyncTest(test)) {
        ioReport.asyncPending++;
        _.set(ioReport.results, testPath, errAsyncTestNotCompleted);
      }
      try {
        _.set(ioReport.results, testPath, test(global, makeTestPassedCallback(testPath, ioReport)));
      } catch (e) {
        _.set(ioReport.results, testPath, e);
      }
    } else {
      runGroupAsync(testPath, test, ioReport);
    }
}

function runGroupAsync(path, group, ioReport) {
  for (var p in group) {
    if (!shouldIgnore(p)) {
      runTestAsync(path.concat(p), group[p], ioReport);
    }
  }
}

/** runs all the test in async mode and calls back with a report */
function runAllAsync(tests, cb) {
  try {
    var report = {env:envInfo(), results: {}, asyncPending:0, tests:tests };
    
    runGroupAsync([], tests, report);
    
    // all tests have been run. We have to wait for completions
    var loopCount = 10;
    var checkFinish = function () {
      // launch next check if pending calls
      if (report.asyncPending > 0) {
        if (--loopCount) {
           console.log("Waiting for completion : ", loopCount, " ", report.asyncPending);
           setTimeout(checkFinish, 100);
           return;
        }
        else { cb(new Error("" + report.asyncPending + " asynchronous tests have not completed")); } 
      } else {
        cb(null, report);
      }
    }
    setTimeout(checkFinish, 100);
  } catch (e) {
    setTimeout(function() { cb(e, null),1});
  }
}



// ------------------------ The builder itself ---------

function capitalize(s/*:string*/) {
  if (s== undefined) return s;
  return s.charAt(0).toUpperCase() + s.substring(1);
}
function lowerize(s/*:string*/) {
  if (s== undefined) return s;
  return s.charAt(0).toLowerCase() + s.substring(1);
}

/** transforms any string to a valid Javascript identifier
 */
function makeIdentifier(str) {
  var parts = str.split(/\W+/).filter(Boolean);
    // filter(Boolean) removes empty parts
  var initial = parts[0];
  if (/[0-9]/.test(initial.charAt(0))) initial = "_" + initial;
  var res = [ initial.toLowerCase() ];
  return [ lowerize(initial) ].concat(parts.slice(1).map(capitalize)).join("");
}

/** extracts the function body from its string representation, as returend by
 * toString()
 * @return {string|undefined} - if extraction fails, returns undefined
 */
function extractFunctionBody(func) {
  var commentedBody = /[^]*\/\*([^]*)\*\/\}$/.exec(func);
  if (commentedBody) {
    return commentedBody[1].trim();
  } else {
    var explicitBody = /^\s*(?:["']use strict["'];)?\s*function\s*([_\w]\w*)?\(([^\)]*)\)\s*\{([^]*)\}\s*$/.exec(func);
    if (explicitBody) {
      return explicitBody[3].trim();
    }
  }
  console.log("Unable to extract function body from : ");
  console.log(func);
  return undefined;
}

/** changed the test source code for our runtime environment */
function adaptToRuntime(body) {
  //body = body.replace(/global\.__createIterableObject/g,"__createIterableObject");
  return body;
}

function isAsyncTest(body) {
  return /asyncTest(Passed|Failed)\(\)/.test(body);
}

function wrapAsyncTest(body) {
  if (!isAsyncTest(body)) return body;
  var str = "var res={}";
  str += "var timer = setTimeout(function() { if (res.status == undefined) { res.status = false} }, 1000);"
  str += "var asyncTestPassed = function () { if (res.status == undefined) { clearTimeout(timer); res.status = true} });"
  str += "var asyncTestFailed = function (err) { if (res.status == undefined) { clearTimeout(timer); res.status = err || new Error('Asynchronous test failed')} });"
  str += "(function() { " + body + "})()";
  str += "return result;"
}

// see https://en.wikipedia.org/wiki/ANSI_escape_code#graphics
var bold = '\x1b[1m';
var underline = '\x1b[4m';
var red = '\x1b[31m';
var green = '\x1b[32m';
var orange = '\x1b[33m';
var blue = '\x1b[34m';
var cyan = '\x1b[36m';
var backCyan = '\x1b[46m';
var noColor = '\x1b[0m';

/** formats a source code line to display the error location */
function formatErrorLine(src, line, col) {
  var text = src.split("\n")[line - 1];
  return chalk.blue(text.substring(0, col)) + chalk.cyan("<!")+chalk.bold.blue(text.substring(col))+chalk.cyan(">");
 }

function logMinifyError(testPath, src, err) {
    console.log("Failed to minify " + chalk.underline(testPath.join(" / ")));
    console.log(formatErrorLine(src, err.line, err.col));
    console.log("  ", err.message);
}

/** tries to minify the function body
 * @param {Array} testPath - test name
 * @param {string} src - the uncommented function body extracted from data files 
 * @param {Function?} onError - the error callback if minification fails 
 */
function tryMinifyBody(testPath, src, onError) {
  var prefix = "function x(){";
  var suffix = "}";
  var func = prefix+src+suffix;
  try {
    //console.log(func);
    var funcMin = UglifyJS.minify(func, {fromString: true});
    // console.log(typeof funcMin);
    
    var res = funcMin.code.substring(prefix.length,funcMin.code.length - suffix.length);
    
    // console.log(res);
    return res;
  } catch (e) {
    if (typeof onError === "function") onError(testPath, func, e);
    return src;
  }
}

/** Escapes a Javascript string
 * */
function jsEscape(str) {
  return JSON.stringify(str + '').slice(1,-1);
}

function runTest(func) {
  var body = extractFunctionBody(func);
  if (body) {
    try {
      var func = new Function(body);
      return {ok:func()};
    } catch (e) {
      return err(e);
    }
  } else {
    return err("unsupported test function");
  }
}

function selectCompiler(name) {
  var compileFunc = undefined;
  switch(name) {
    case "babel" : 
      compileFunc = function (src) { return babel.transform(src, {presets: ['es2015']} ).code; };
      break;
    default: return undefined;
  }
  return function (src) {
    try { 
      return compileFunc(src);
    } catch (e) {
      return new Error("Unable to compile");
    }
  }
}

/** tests if regex can match a part of pathItem
 * Always returns true if regex is null, undefined or "*" */
function matchStep(regex, pathItem) {
  return regex == null || regex === "*" || regex.test(pathItem || "");
}

/** returns true if testPath matches the pathFilter
 * If pathFilter is an array of RegExp, tries to match each path step to 
 *   the corresponding filter
 * Otherwise, tries to match each step to the RegExp and returns true if one of them matches
 */
function matchFilter(pathFilter /*RegExp|Regexp[] */, testPath /*:string[]*/)/*:boolean*/ {
  if (_.isArray(pathFilter)) {
    for (var i = 0; i < pathFilter.length; ++i) {
      if (!matchStep(pathFilter[i], testPath[i])) {
        return false;
      }
    }
    return true;
  } else {
    // a single RegExp : accept if any ot the steps satisfies the RegEx
    return _.any(testPath, pathFilter.test.bind(pathFilter));
  }
}

/** returns true if testPath matches at least one of the supplied filters
 */
function matchAny(filters, testPath) {
  if (filters != null) {
    for (var i =0; i < filters.length; ++i) {
      var curFilter = filters[i];
      if (matchFilter(filters[i], testPath)) {
        return true;
      }
    }
  }
  return false;
}

/** a class which holds all information on a specific generation task
 */
function GenerationReport() {
  this.included = [];
  this.excluded = [];
  this.minifyErrors = [];
}
GenerationReport.prototype.addMinifyError = function addMinifyError(testPath, func, e) {
    this.minifyErrors.push( { test:testPath, error:e.message, src: formatErrorLine(func, e.line, e.col)} );
    logMinifyError(testPath, func, e);
};

/** returns true if 
 * - options include the testPath
 * - AND options do not exclude the testPath
 * @param {object} options
 * @param {array} options.includes
 * @param {array} options.excludes
 */
function accept(options, testPath) {
  // console.log(chalk.cyan(testPath), options.includes, options.excludes);
  var isIncluded = options.includes == null || options.includes.length === 0 || matchAny(options.includes, testPath);
  var isExcluded = options.excludes != null && options.excludes.length !== 0 && matchAny(options.excludes, testPath);
  // var shouldExclude = (options.excludes != null && matchAny(options.excludes, testPath));
  var res = isIncluded
      && !isExcluded;
  if (options.verbose && !res) {
    console.log(isIncluded 
          ? chalk.yellow(testPath.join("/"), " excluded")
          : chalk.magenta(testPath.join("/"), " not included"));
  }
  // console.log(chalk.cyan(testPath)," : ",res, " {", isIncluded,',', isExcluded, '}');
  return res;
}

/** generates a test property and its function ,
 * @param {object|null} options
 * @param {boolean} options.minify- if true, source is minified
 * @param {boolean} options.sync - if true, synchronous tests are generated
 * @param {boolean} options.async - if true, asynchronous tests are generated
 * @param {string} test - the test source code
 * @param {string[]} testPath - the path to this test in the source object
 * @param {object} ioReport -
 * @param {string} tab - the indentation for this
*/
function genTestString(options,test, testPath, ioReport, tab) {
  options = options || {};
  var body = extractFunctionBody(test.exec.toString());
  var keepIt = true;
  if (body) {
    // test for async before compiling, because linting compilers discard the original source code
    var isAsync = isAsyncTest(body); 
    keepIt = (isAsync && options.async) || (!isAsync && options.sync);
    if (options.compilerFunction) {
      // body may contain a return statement, which can only appear in a function definition
      body = options.compilerFunction("function z(){" + body + "} ") + "return z();";
    }
    body = adaptToRuntime(body);
  } else {
    body = 'return new Error("Unable to extract function body")';
  }   
  var res = "";
  if (keepIt) {
    var bodyMin = options.minify ? tryMinifyBody(testPath, body, ioReport.addMinifyError.bind(ioReport)) : body;
    //str += "// " + body.length + " chars, "+bodyMin.length+ " minified\n"
    //res += "\n" + tab +"\""+jsEscape(last(testPath))+"\":";
    res += "\n" + tab +makeIdentifier(last(testPath))+":";
    res += (isAsync ? "a" :"f") +"(\"";
    res += jsEscape(bodyMin);
    res += "\")";
    return res;
  }
}

/** generates the source code for a group of tests
 * @param {array} groupPath - the path to this group in the tree
 * @param {object} tests - the source test definitions (as provided by data-esX.js)
 * @param {object} options
 * @param {boolean} options.minify
 * @param {object} ioReport - the generation report, mutable
 * @param {string} tab - the tabulation for this group
 * */ 
function genTestGroup(groupPath, tests, options, ioReport, tab) {
  if (tests == null) return "";
  var str = "";
  var testCount = 0;  // number of accepted tests
  tests.forEach( function (test, testIdx) {
    var testTab = tab + "  ";
      if (test.subtests) {
        var subStr = "";
        var subCount = 0;
        test.subtests.forEach( function (sub, subIdx) {
          var testPath = groupPath.concat([test.name, sub.name]);
          if (accept(options, testPath)) {
            ioReport.included.push(testPath.join("/"));
            //str += "// " + body.length + " chars, "+bodyMin.length+ " minified\n"
            if (subCount != 0) subStr += ","
            subStr += genTestString(options,sub, testPath, ioReport, testTab + "  ");
            subCount++;
          } else {
            ioReport.excluded.push(testPath.join("/"));
          }
        }); // foreach
        if (subStr.length != 0) {
          // at least one subtest, we have to add this test
          if (testCount) str+= ","
          str += "\n" + testTab + "\""+jsEscape(test.name)+"\": { // test+";
          //str += "\n" + testTab + makeIdentifier(test.name)+": { // test+";
          str += subStr;
          str += "\n"+ testTab + "}";
          testCount++;
        }
      } else {  // it'a single test
          var testPath = groupPath.concat([test.name]);
          if (accept(options, testPath)) {
            ioReport.included.push(testPath.join("/"));
            if (testCount) str+= ",";
            str += genTestString(options, test, testPath, ioReport, tab);
            testCount++;
          } else {
            ioReport.excluded.push(testPath.join("/"));
          }
      }
  }); // foreach
  if (str.length != 0) {
    str = "\n" + tab + makeIdentifier(last(groupPath)) + ": {\n" + str +"\n"+ tab + "}";
  }
  return str;
}

function genByCategory(groupPath, tests, options, ioReport, tab) {
  tab = tab || "";
  var categories = new Object();
  tests.forEach( function(test) { var c = test.category; if (c) categories[c] = c;});
  if (Object.keys(categories).length != 0) {
    var str = "";
    Object.keys(categories).forEach(function(category) {
      var categoryPath = groupPath.concat([category]);
      var categoryTests = tests.filter(function(item) { return item.category == category});
      var strGroup = genTestGroup(categoryPath, categoryTests, options, ioReport, tab + "  ");
      if (strGroup.length != 0) {
        if (str.length != 0) { str += "," }
        str += strGroup;
      }
    });
    if (str.length != 0) {
      str+= "// category " + groupPath + "\n";
      str = "\n" + tab + makeIdentifier(last(groupPath)) + ": { // group\n" + str;
      str +="\n" + tab + "}";
    }
    return str;
  } else {
    // no categories for this group
    return genTestGroup(groupPath, tests, options, ioReport, tab);
  }
}

/** @param {object} options
 * @param {array} options.includes
 * @param {array} options.excludes
 * @param {boolean} options.minify - if true, will try to minify the test code
 */
function generateTests(filename, options) {
  var report = new GenerationReport();
  options = options || {};
  var str = "";
  try {
    str += "// ES6 compatibility checks\n";
    str += "// -------------------------\n";
    str += "var unableMsg = '"+ unableMsg + "';\n";
    str += "function wrapStrict(f) { return function() { var v = f(); return v === true ? 'strict' : v; } }\n";
    str += "function f(b){try{return new Function('global',b)} catch(e){" 
      + "try { return wrapStrict(new Function('global','\"use strict\";'+b)); } catch (ee) { return function(){return ee;}}}}\n";
    // str += "function a(b){return function() { return new Error(unableMsg)}}\n"
    str += "function a(b){ try { return new Function('global', 'asyncTestPassed', b); } catch (e) { return e; } }\n";
    str += "module.exports = {";
    var groups = [
              genTestGroup(['internal'], tests.internal, options, report, "  "),
              genTestGroup(['es5'], tests.es5, options, report, "  "),
              genByCategory(['es6'], tests.es6, options, report, "  "),
              genByCategory(['es7'], tests.es7, options, report, "  ")];
    str += joinNotEmpty(groups, ",\n");
    str+="\n};\n";
    fs.writeFileSync(filename,str);
  } catch (e) {
    console.error("Unable to generate '" + filename +"' (" + e +")");
    if (options.verbose) {
      console.log(e.stackTrace);
    }
  } finally {
  }
  return report;
}

function dumpGenerationResult(result) {
  console.log("test count: " + result.included.length + " ( excluded " + result.excluded.length + " tests)");
  console.log("  " + result.minifyErrors.length + " minification errors");
}

function writeChecksJs(options, filename) {
  if (!filename) filename = "./compatCheck.js"; 
  var res = generateTests(filename, options);
  dumpGenerationResult(res);
  console.log("File ",filename," has been generated");
}

function runAllTests() {
  tests.forEach( function (test) {
    console.log(test.name);
    if (test.subtests) {
      test.subtests.forEach( function (sub) {
        console.log("  " + sub.name);
        console.log(runTest(sub.exec.toString()));
      })
    }
  });
}


function runRecursiveAsync(tests, depth, cb) {
  depth = depth || 0;
  var testResults = {};
  try {
 
    for (name in tests) {
      var test = tests[name];
      if (typeof test === "function") {
        var result;
        try {
          result = test( global );
        } catch (e) {
          result = e;
        }
      } else {
        runRecursiveAsync(test, depth + 1);
      }
    }
  } catch (e) {
    cb(e);
  }
}

function loadAndRunAllAsync(file, cb) {
  try { 
    var tests = require(file);
    runRecursive(tests, cb);
  } catch (e) {
    cb(e,null);
  }
}

function runRecursive(tests, depth) {
  depth = depth || 0;
  
  for (name in tests) {
    var test = tests[name];
    if (typeof test === "function") {
      var result;
      try {
        result = test(global);
      } catch (e) {
        result = e;
      }
      var unableToRun = (result instanceof Error) && result.message == unableMsg;
      var strictOnly = (result === "strict");
      var color = strictOnly ? cyan : (unableToRun ? blue : (result == true ? green : red));
      var check = (result == true ? '\u2714' : '\u2718')
      console.log(color, check, "\t", name, noColor, "> ", clipString(30,result));
    } else {
      console.log('\u25BC\t', name);
      runRecursive(test, depth + 1);
    }
  }
}

function loadAndRunAll(file) {
  try {
    var tests = require(file);
    runRecursive(tests);
  } catch (e) {
    console.log("unable to load file " + file);
    console.log(e);
    console.log(e.stack);
  }
}

function runSingleTest(test, path) {
  if (typeof test !== "function") return test;
  try {
    return test();
  } catch (e) { return e; }
}

// from @megawac here http://stackoverflow.com/questions/25333918/js-deep-map-function
function runAllAndReport(obj, path) {
  if (path == null) path = [];
  if (typeof obj === "function") {
    return runSingleTest(obj, path);
  } else {
    var  res = {__path: path };
    for (var p in obj) {
      res[p] = runAllAndReport(obj[p], res.__path.concat(p));
    }
    return res;
  }
}

/** returns true if running node */
function inNodeJs()/*:boolean*/ {
  try {
    return Object.prototype.toString.call(process) === '[object process]' 
  } catch(e) { return false; }
}

/** returns an object with information about the runtime environment 
 * @see https://nodejs.org/docs/  
*/
function envInfo() {
  var res = {}
  if (inNodeJs()) {
    var os = require("os");
    var process = require("process");
    res.node = {
      os: { type: os.type() // in v0.4.4
            , release: os.release() // in v0.4.4
       }
      , version: process.version
      , arch: process.arch
      , platform: process.platform
      , v8 : process.versions.v8
      }
  }
  if (typeof navigator !== "undefined") {
    res.navigator = {
      appName: navigator.appName
      , appVersion : navigator.appVersion
      , platform : navigator.platform
      , product : navigator.product
      , userAgent : navigator.userAgent
    }
  }
  return res;
}

/** loads, runs the tests and generates a report of all tests in a file 
 * 
 * Returns an object with :
 * - results : a tree of objects holding the results of individual tests
 * - env : information about the runtime environment
 * - tests: the tests which were provided
*/
function runAllFromFileAndReport(file) {
  try {
    var tests = require(file);
    var results= runAllAndReport(tests);
    return {env:envInfo(), results:results, tests:tests };
  } catch (e) {
    console.log("unable to load file " + file);
    console.log(e);
    console.log(e.stack);
  }
}

function isSuccess(testResult) {
  return !(typeof testResult === "object") && testResult == true;
}

function shouldIgnore(key) {
  return typeof key !== "string" || key.startsWith("__");
}

/** computes the test summary statistics for a test report */
function summary(report) {
  var res = { __count:0, __success:0};
  _.forIn(report, function (val, key) {
    if (shouldIgnore(key)) return;
    if (_.isObject(val) && !(val instanceof Error)) {
      // we have a set of subtests
      var s = summary(val);
      res.__count += s.__count;
      res.__success += s.__success;
    } else {
      // this is a final test
       res.__count++;
      if (isSuccess(val))  res.__success++;
    }
  });
  //report.__summary = res;
  return res;
}

function displayTest(options,result, path, tests) {
  if (options.summary) return;
  if (options.fail && result == true) return;
  var unableToRun = (result instanceof Error) && result.message == unableMsg;
  var strictOnly = (result === "strict");
  var color = strictOnly ? chalk.cyan : (unableToRun ? chalk.blue : (result == true ? chalk.green : chalk.red));
  var check = (result == true ? '\u2714' : '\u2718')
  console.log(color(check, "\t", ind(options.indent ? path.length : 0), last(path)));
  if (options.errors && (result instanceof Error)) {
    console.log("\t\t", clipString(70,result))
  }
  if (options.src && tests) {
    var test = _.get(tests, path);
    console.log("------------------------");
    console.log(indentCode(4, test.toString()));
    //console.log(highlight(test.toString(), {
    //  // optional options
    //  language: 'javascript', // will auto-detect if omitted
    //  theme: 'default' // a highlight.js theme
    // }));
    console.log("------------------------");
  }
}

function displayReportResults(options, testResults, path, tests) {
  //console.log(JSON.stringify(report,null," "));
  //console.log(report);
  _.forIn(testResults, function(test, name){ 
    // ignore private fields
    if (shouldIgnore(name)) return;
    var testPath = path.concat(name);
    if (typeof test !== "object" || test instanceof Error) {
      // it is an elmentary test
      if (!options.fails || test != true)
        displayTest(options, test, testPath, tests);
    } else {
      var sum = summary(test);
      var full = sum.__count === sum.__success;
      var none = 0 === sum.__success;
      var color = (full ? chalk.green : (none ? chalk.red : chalk.yellow));
      if (options.fail && full) return;
      console.log("\t",ind(options.indent ? path.length : 0), name,' ', color(sum.__success,"/",sum.__count));
      displayReportResults(options, test, testPath, tests);
    }
  }); 
};

function displayReport(options, report) {
  // display excluded tests
  if (report.excluded && report.excluded.length !== 0) {
    console.log(report.excluded.length," tests have been excluded");
    if (options.verbose) {
      console.log("\tThe following tests have been excluded")
      _.each(report.excluded, function(testPath) {
        console.log("\t* ",testPath);
      });
    }
  }
  // display results
  displayReportResults(options, report.results, [], report.tests);
}

function computeAndReport(options, file) {
  // console.log(options);
  var report = runAllFromFileAndReport(file);
  //console.log(JSON.stringify(report));
  displayReport(options, report);
}

/** loads, runs the tests and generates a report of all tests in a file 
 * 
 * Returns an object with :
 * - results : a tree of objects holding the results of individual tests
 * - env : information about the runtime environment
 * - tests: the tests which were provided
*/
function runAllFromFileAsync(file, cb) {
  try {
    var tests = require(file);
    runAllAsync(tests, cb);
  } catch (e) {
    console.log("unable to load file " + file);
    console.log(e);
    console.log(e.stack);
    cb(e);
  }
}

function computeAndReportAsync(options, file) {
  console.log("-------------------------");
  console.log("Running tests from file '",file,"'");
  console.log();
  runAllFromFileAsync(file, function (err, report) {
    if (err) {
      console.error("An error occured while asychronoulsy running the tests : ", err);
    } else {
      displayReport(options, report);
    }
  })
}

function go(options,file) { 
  //loadAndRunAll(file);
  computeAndReportAsync(options,file);
}

function writeAndGo(options, file) {
  if (options.compiler) {
    options.compilerFunction = selectCompiler(options.compiler);
  }
  if (options.generate) writeChecksJs(options, file);
  if (options.run) go(options, file);
}

function arr(x) { return x != null ? (_.isArray(x) ? x : [ x ]) : [] }
function unarr(x) { return x.length === 0 ? null : x }

function strToFilter(str) {
  try {
    if (str == null) return str;
    var res = str.toString().split('/').map( function (x) { return (x != "" && x != "*") ? new RegExp(makeIdentifier(x)) : null; } )
    return res.length === 1 ? res[0] : res;
  } catch (e) {
    console.error(chalk.red("Invalid filter : "),str);
    process.exit(-1);
  }
}

var testGroups = _.transform({
  es5: 'es5',
  es6: 'es6',
  es7: 'es7',
  // es6 categories
  es6_optimisation: 'es6/optimisation',
  es6_syntax: 'es6/syntax',
  es6_bindings: 'es6/bindings',
  es6_functions: 'es6/functions',
  es6_builtIns: 'es6/builtIns',
  es6_builtInExtensions: 'es6/builtInExtensions',
  es6_subclassing: 'es6/subclassing',
  es6_misc: 'es6/misc',
  es6_annexB: 'es6/annex b',
  // some es6 features
  properTailCalls : 'es6//properTailCalls',
  defaultFunctionParameters: 'es6//default function parameters',
  restParameters: 'es6//rest parameters',
  spreadOperator: 'es6//spread (...) operator',
  objectLiteraleExtensions: 'es6//object literal extensions',
  forOfLoops: 'es6//for\.\.of loops',
  octalAndBinaryLiterals:'es6//octal and binary literals',
  templateStrings:'es6//template strings',
  regExpYandUflags:'es6//RegExp "y" and "u" flags',
  destructuring:'es6//destructuring',
  unicodeCodePointEscapes:'es6//Unicode code point escapes',
  const:'es6//const',
  let:'es6//let',
  blockLevelFunctionDeclaration:'es6//block-level function declaration',
  arrowFunctions:'es6//arrow functions',
  class:'es6//class',
  super:'es6//super',
  generators:'es6//generators',
  typedArrays : 'es6//typed arrays',
  map:'es6//Map',
  set:'es6//Set',
  noAssignmentsAllowedInForInHead:'es6///noAssignmentsAllowedInForInHead',
  miscellaneous:'es6//miscellaneous'
}, function (acc, val, key) { acc[key] = strToFilter(val); });

argv.includes = unarr(arr(argv._).map(strToFilter));
argv.excludes = unarr(arr(argv.x).map(strToFilter));
if (argv.verbose) {
  console.log("Will include following filters:\n", argv.includes);
  console.log("Will exclude following filters:\n", argv.excludes);
}
// writeAndGo({include:[testGroups.es5]}, "./out/compatES5.js");

//writeAndGo({include:[testGroups.es6], noMinify:true}, "./out/compatES6.js");

//writeAndGo({include:[testGroups.es7]}, "./out/compatES7.js");

writeAndGo(argv, argv.file);
