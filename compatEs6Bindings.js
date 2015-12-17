// ES6 compatibility checks
// -------------------------
var unableMsg = 'Unable to run this test';
function wrapStrict(f) { return function() { var v = f(); return v === true ? 'strict' : v; } }function f(b){try{return new Function(b)} catch(e){try { return wrapStrict(new Function('"use strict";'+b)); } catch (ee) { return function(){return ee;}}}}
function a(b){return function() { return new Error(unableMsg)}}
module.exports = {
  "es6": { // group

    "bindings": {

      "const": { // test+
        "basic support":f("\n        const foo = 123;\n        return (foo === 123);\n      "),
        "is block-scoped":f("\n        const bar = 123;\n        { const bar = 456; }\n        return bar === 123;\n      "),
        "redefining a const is an error":f("\n        const baz = 1;\n        try {\n          Function(\"const foo = 1; foo = 2;\")();\n        } catch(e) {\n          return true;\n        }\n      "),
        "temporal dead zone":f("\n        var passed = (function(){ try { qux; } catch(e) { return true; }}());\n        function fn() { passed &= qux === 456; }\n        const qux = 456;\n        fn();\n        return passed;\n      "),
        "basic support (strict mode)":f("\n        \"use strict\";\n        const foo = 123;\n        return (foo === 123);\n      "),
        "is block-scoped (strict mode)":f("\n        'use strict';\n        const bar = 123;\n        { const bar = 456; }\n        return bar === 123;\n      "),
        "redefining a const (strict mode)":f("\n        'use strict';\n        const baz = 1;\n        try {\n          Function(\"'use strict'; const foo = 1; foo = 2;\")();\n        } catch(e) {\n          return true;\n        }\n      "),
        "temporal dead zone (strict mode)":f("\n        'use strict';\n        var passed = (function(){ try { qux; } catch(e) { return true; }}());\n        function fn() { passed &= qux === 456; }\n        const qux = 456;\n        fn();\n        return passed;\n      ")
      },
      "let": { // test+
        "basic support":f("\n        let foo = 123;\n        return (foo === 123);\n      "),
        "is block-scoped":f("\n        let bar = 123;\n        { let bar = 456; }\n        return bar === 123;\n      "),
        "for-loop statement scope":f("\n        let baz = 1;\n        for(let baz = 0; false; false) {}\n        return baz === 1;\n      "),
        "temporal dead zone":f("\n        var passed = (function(){ try {  qux; } catch(e) { return true; }}());\n        function fn() { passed &= qux === 456; }\n        let qux = 456;\n        fn();\n        return passed;\n      "),
        "for-loop iteration scope":f("\n        let scopes = [];\n        for(let i = 0; i < 2; i++) {\n          scopes.push(function(){ return i; });\n        }\n        let passed = (scopes[0]() === 0 && scopes[1]() === 1);\n\n        scopes = [];\n        for(let i in { a:1, b:1 }) {\n          scopes.push(function(){ return i; });\n        }\n        passed &= (scopes[0]() === \"a\" && scopes[1]() === \"b\");\n        return passed;\n      "),
        "basic support (strict mode)":f("\n        'use strict';\n        let foo = 123;\n        return (foo === 123);\n      "),
        "is block-scoped (strict mode)":f("\n        'use strict';\n        let bar = 123;\n        { let bar = 456; }\n        return bar === 123;\n      "),
        "for-loop statement scope (strict mode)":f("\n        'use strict';\n        let baz = 1;\n        for(let baz = 0; false; false) {}\n        return baz === 1;\n      "),
        "temporal dead zone (strict mode)":f("\n        'use strict';\n        var passed = (function(){ try {  qux; } catch(e) { return true; }}());\n        function fn() { passed &= qux === 456; }\n        let qux = 456;\n        fn();\n        return passed;\n      "),
        "for-loop iteration scope (strict mode)":f("\n        'use strict';\n        let scopes = [];\n        for(let i = 0; i < 2; i++) {\n          scopes.push(function(){ return i; });\n        }\n        let passed = (scopes[0]() === 0 && scopes[1]() === 1);\n\n        scopes = [];\n        for(let i in { a:1, b:1 }) {\n          scopes.push(function(){ return i; });\n        }\n        passed &= (scopes[0]() === \"a\" && scopes[1]() === \"b\");\n        return passed;\n      ")
      },
    "block-level function declaration":f("\n    'use strict';\n    function f() { return 1; }\n    {\n      function f() { return 2; }\n    }\n    return f() === 1;\n  ")
    }// category es6

  }
};
