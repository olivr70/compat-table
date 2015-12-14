

var fs         = require('fs');
var UglifyJS = require("uglify-js");

var dataES5 = require("./data-es5");
var dataES6 = require("./data-es6");
var dataES7 = require("./data-es7");
var tests = {es5: dataES5.tests, es6 : dataES6.tests, es7: dataES7.tests };

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

/** extracts the function body from its string representation, as returend by
 * toString()
 */
function funcBody(func) {
  var commentedBody = /[^]*\/\*([^]*)\*\/\}$/.exec(func);
  if (commentedBody) {
    return commentedBody[1];
  } else {
    var explicitBody = /^\s*function\s*\(([^\)]*)\)\s*\{([^]*)\}\s*$/.exec(func);
    if (explicitBody) {
      return explicitBody[2];
    }
  }
}

function isAsyncTest(body) {
  return /asyncTestPassed\(\)/.test(body);
}

function wrapAsyncTest(body) {
  if (!isAsyncTest(body)) return body;
  var str = "var res={}";
  str += "var timer = setTimeout(function() { if (res.status == undefined) { res.status = false} }, 1000);"
  str += "var asyncTestPassed = function () { if (res.status == undefined) { clearTimeout(timer); res.status = true} });"
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
  return blue + text.substring(0, col) + cyan + "<!"+bold+blue+text.substring(col)+cyan+">" + noColor;
}

function logMinifyError(testPath, src, err) {
    console.log("Failed to minify " + underline + testPath.join(" / ") + noColor);
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
  var body = funcBody(func);
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

/** tests if regex can match a part of pathItem
 * Always returns true if regex is null, undefined or "*" */
function matchStep(regex, pathItem) {
  return regex == null || regex === "*" || regex.test(pathItem || "");
}

function matchFilter(pathFilter, testPath) {
  for (var i = 0; i < pathFilter.length; ++i) {
    if (!matchStep(pathFilter[i], testPath[i])) {
      return false;
    }
  }
  return true;
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
 */
function accept(options, testPath) {
  var isIncluded = matchAny(options.include, testPath);
  var isExcluded = matchAny(options.exclude, testPath);
  var shouldExclude = (options.exclude != null && matchAny(options.exclude, testPath));
  return (options.include == null || matchAny(options.include, testPath))
      && (options.exclude == null || !matchAny(options.exclude, testPath));
}

/** generates a test property and its function */
function genTestString(options,test, testPath, ioReport, tab) {
  options = options || {};
  var body = funcBody(test.exec.toString());
  var isAsync = isAsyncTest(body);
  var bodyMin = options.noMinify ? body : tryMinifyBody(testPath, body, ioReport.addMinifyError.bind(ioReport));
  var res = "";
  //str += "// " + body.length + " chars, "+bodyMin.length+ " minified\n"
  res += "\n" + tab +"\""+jsEscape(last(testPath))+"\":";
  res += (isAsync ? "a" :"f") +"(\"";
  res += jsEscape(bodyMin);
  res += "\")";
  return res;
}


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
            //str += "// " + body.length + " chars, "+bodyMin.length+ " minified\n"
            if (subCount != 0) subStr += ","
            subStr += genTestString(options,sub, testPath, ioReport, testTab + "  ");
            subCount++;
          } else {
            ioReport.excluded.push(testPath.join("/"));
            console.log("excluded " + test.name + " / " + sub.name);
          }
        }); // foreach
        if (subStr.length != 0) {
          // at least one subtest, we have to add this test
          if (testCount) str+= ","
          str += "\n" + testTab + "\""+jsEscape(test.name)+"\": { // test+";
          str += subStr;
          str += "\n"+ testTab + "}";
          testCount++;
        }
      } else {  // it'a single test
          var testPath = groupPath.concat([test.name]);
          if (accept(options, testPath)) {
            if (testCount) str+= ",";
            str += genTestString(options, test, testPath, ioReport, tab);
            testCount++;
          }
      }
  }); // foreach
  if (str.length != 0) {
    str = "\n" + tab + '"' + jsEscape(last(groupPath)) + "\": {\n" + str +"\n"+ tab + "}";
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
      str = "\n" + tab + '"' + jsEscape(last(groupPath)) + "\": { // group\n" + str;
      str +="\n" + tab + "}";
    }
    return str;
  } else {
    // no categories for this group
    return genTestGroup(groupPath, tests, options, ioReport, tab);
  }
}

/** @param {object} options
 * @param {array} options.include
 * @param {array} options.exclude
 */
function generateTests(filename, options) {
  var report = new GenerationReport();
  options = options || {};
  var str = "";
  try {
    str += "// ES6 compatibility checks\n";
    str += "// -------------------------\n";
    str += "var unableMsg = '"+ unableMsg + "';\n";
    str += "function f(b){try{return new Function(b)} catch(e){return function(){return e;}}}\n";
    str += "function a(b){return function() { return new Error(unableMsg)}}\n"
    str += "module.exports = {";
    var groups = [genTestGroup(['es5'], tests.es5, options, report, "  "),
              genByCategory(['es6'], tests.es6, options, report, "  "),
              genByCategory(['es7'], tests.es7, options, report, "  ")];
    str += joinNotEmpty(groups, ",\n");
    str+="\n};\n";
    fs.writeFileSync(filename,str);
  } catch (e) {
    console.error("Unable to generate '" + filename +"' (" + e +")")
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
          result = test( );
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
        result = test();
      } catch (e) {
        result = e;
      }
      var unableToRun = (result instanceof Error) && result.message == unableMsg;
      var color = unableToRun ? blue : (result === true ? green : red);
      console.log(ind(depth * 2), color, name, noColor, "> ", result);
    } else {
      console.log(ind(depth * 2), name);
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

var testGroups = {
  es5: [/es5/],
  es6: [/es6/],
  es7: [/es7/],
  // es6 categories
  es6_optimisation: [/es6/,/optimisation/],
  es6_syntax: [/es6/,/syntax/],
  es6_bindings: [/es6/,/bindings/],
  es6_functions: [/es6/,/functions/],
  es6_builtIns: [/es6/,/built-ins/],
  es6_builtInExtensions: [/es6/,/built-in extensions/],
  es6_subclassing: [/es6/,/subclassing/],
  es6_misc: [/es6/,/misc/],
  es6_annexB: [/es6/,/annexB/],
  // some es6 features
  properTailCalls : [/es6/,null,/proper tail calls/],
  defaultFunctionParameters: [/es6/,null,/default function parameters/],
  restParameters: [/es6/,null,/rest parameters/],
  spreadOperator: [/es6/,null,/spread (...) operator/],
  objectLiteraleExtensions: [/es6/,null,/object literal extensions/],
  forOfLoops: [/es6/,null,/for\.\.of loops/],
  octalAndBinaryLiterals:[/es6/,null,/octal and binary literals/],
  templateStrings:[/es6/,null,/template strings/],
  regExpYandUflags:[/es6/,null,/RegExp "y" and "u" flags/],
  destructuring:[/es6/,null,/destructuring/],
  unicodeCodePointEscapes:[/es6/,null,/Unicode code point escapes/],
  const:[/es6/,null,/const/],
  let:[/es6/,null,/let/],
  blockLevelFunctionDeclaration:[/es6/,null,/block-level function declaration/],
  arrowFunctions:[/es6/,null,/arrow functions/],
  class:[/es6/,null,/class/],
  super:[/es6/,null,/super/],
  generators:[/es6/,null,/generators/],
  typedArrays : [/es6/,null,/typed arrays/],
  map:[/es6/,null,/Map/],
  set:[/es6/,null,/Set/],
}

var f = new Function("return\"function\"==typeof Object.create");

//writeChecksJs({include:[testGroups.es5]}, "./compatES5.js");
//loadAndRunAll("./compatES5.js");

writeChecksJs({include:[testGroups.es6], noMinify:true}, "./compatES6.js");
loadAndRunAll("./compatES6.js");

//writeChecksJs({include:[testGroups.es7]}, "./compatES7.js");
//loadAndRunAll("./compatES7.js");

//writeChecksJs({include:[testGroups.generators]}, "./compatRest.js");

