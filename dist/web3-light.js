require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file abi.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @author Gav Wood <g@ethdev.com>
 * @date 2014
 */

var utils = require('../utils/utils');
var coder = require('./coder');
var solUtils = require('./utils');

/**
 * Formats input params to bytes
 *
 * @method formatInput
 * @param {Array} abi inputs of method
 * @param {Array} params that will be formatted to bytes
 * @returns bytes representation of input params
 */
var formatInput = function (inputs, params) {
    var i = inputs.map(function (input) {
        return input.type;
    });
    return coder.encodeParams(i, params);
};

/** 
 * Formats output bytes back to param list
 *
 * @method formatOutput
 * @param {Array} abi outputs of method
 * @param {String} bytes represention of output
 * @returns {Array} output params
 */
var formatOutput = function (outs, bytes) {
    var o = outs.map(function (out) {
        return out.type;
    });
    
    return coder.decodeParams(o, bytes); 
};

/**
 * Should be called to create input parser for contract with given abi
 *
 * @method inputParser
 * @param {Array} contract abi
 * @returns {Object} input parser object for given json abi
 * TODO: refactor creating the parser, do not double logic from contract
 */
var inputParser = function (json) {
    var parser = {};
    json.forEach(function (method) {
        var displayName = utils.extractDisplayName(method.name);
        var typeName = utils.extractTypeName(method.name);

        var impl = function () {
            var params = Array.prototype.slice.call(arguments);
            return formatInput(method.inputs, params);
        };

        if (parser[displayName] === undefined) {
            parser[displayName] = impl;
        }

        parser[displayName][typeName] = impl;
    });

    return parser;
};

/**
 * Should be called to create output parser for contract with given abi
 *
 * @method outputParser
 * @param {Array} contract abi
 * @returns {Object} output parser for given json abi
 */
var outputParser = function (json) {
    var parser = {};
    json.forEach(function (method) {

        var displayName = utils.extractDisplayName(method.name);
        var typeName = utils.extractTypeName(method.name);

        var impl = function (output) {
            return formatOutput(method.outputs, output);
        };

        if (parser[displayName] === undefined) {
            parser[displayName] = impl;
        }

        parser[displayName][typeName] = impl;
    });

    return parser;
};

var formatConstructorParams = function (abi, params) {
    var constructor = solUtils.getConstructor(abi, params.length);
    if (!constructor) {
        if (params.length > 0) {
            console.warn("didn't found matching constructor, using default one");
        }
        return '';
    }
    return formatInput(constructor.inputs, params);
};

module.exports = {
    inputParser: inputParser,
    outputParser: outputParser,
    formatInput: formatInput,
    formatOutput: formatOutput,
    formatConstructorParams: formatConstructorParams
};

},{"../utils/utils":8,"./coder":2,"./utils":5}],2:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file coder.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var BigNumber = require('bignumber.js');
var utils = require('../utils/utils');
var f = require('./formatters');
var SolidityParam = require('./param');

/**
 * Should be used to check if a type is an array type
 *
 * @method isArrayType
 * @param {String} type
 * @return {Bool} true is the type is an array, otherwise false
 */
var isArrayType = function (type) {
    return type.slice(-2) === '[]';
};

/**
 * SolidityType prototype is used to encode/decode solidity params of certain type
 */
var SolidityType = function (config) {
    this._name = config.name;
    this._match = config.match;
    this._mode = config.mode;
    this._inputFormatter = config.inputFormatter;
    this._outputFormatter = config.outputFormatter;
};

/**
 * Should be used to determine if this SolidityType do match given type
 *
 * @method isType
 * @param {String} name
 * @return {Bool} true if type match this SolidityType, otherwise false
 */
SolidityType.prototype.isType = function (name) {
    if (this._match === 'strict') {
        return this._name === name || (name.indexOf(this._name) === 0 && name.slice(this._name.length) === '[]');
    } else if (this._match === 'prefix') {
        // TODO better type detection!
        return name.indexOf(this._name) === 0;
    }
};

/**
 * Should be used to transform plain param to SolidityParam object
 *
 * @method formatInput
 * @param {Object} param - plain object, or an array of objects
 * @param {Bool} arrayType - true if a param should be encoded as an array
 * @return {SolidityParam} encoded param wrapped in SolidityParam object 
 */
SolidityType.prototype.formatInput = function (param, arrayType) {
    if (utils.isArray(param) && arrayType) { // TODO: should fail if this two are not the same
        var self = this;
        return param.map(function (p) {
            return self._inputFormatter(p);
        }).reduce(function (acc, current) {
            acc.appendArrayElement(current);
            return acc;
        }, new SolidityParam('', f.formatInputInt(param.length).value));
    } 
    return this._inputFormatter(param);
};

/**
 * Should be used to transoform SolidityParam to plain param
 *
 * @method formatOutput
 * @param {SolidityParam} byteArray
 * @param {Bool} arrayType - true if a param should be decoded as an array
 * @return {Object} plain decoded param
 */
SolidityType.prototype.formatOutput = function (param, arrayType) {
    if (arrayType) {
        // let's assume, that we solidity will never return long arrays :P 
        var result = [];
        var length = new BigNumber(param.prefix, 16);
        for (var i = 0; i < length * 64; i += 64) {
            result.push(this._outputFormatter(new SolidityParam(param.suffix.slice(i, i + 64))));
        }
        return result;
    }
    return this._outputFormatter(param);
};

/**
 * Should be used to check if a type is variadic
 *
 * @method isVariadicType
 * @param {String} type
 * @returns {Bool} true if the type is variadic
 */
SolidityType.prototype.isVariadicType = function (type) {
    return isArrayType(type) || this._mode === 'bytes';
};

/**
 * Should be used to shift param from params group
 *
 * @method shiftParam
 * @param {String} type
 * @returns {SolidityParam} shifted param
 */
SolidityType.prototype.shiftParam = function (type, param) {
    if (this._mode === 'bytes') {
        return param.shiftBytes();
    } else if (isArrayType(type)) {
        var length = new BigNumber(param.prefix.slice(0, 64), 16);
        return param.shiftArray(length);
    }
    return param.shiftValue();
};

/**
 * SolidityCoder prototype should be used to encode/decode solidity params of any type
 */
var SolidityCoder = function (types) {
    this._types = types;
};

/**
 * This method should be used to transform type to SolidityType
 *
 * @method _requireType
 * @param {String} type
 * @returns {SolidityType} 
 * @throws {Error} throws if no matching type is found
 */
SolidityCoder.prototype._requireType = function (type) {
    var solidityType = this._types.filter(function (t) {
        return t.isType(type);
    })[0];

    if (!solidityType) {
        throw Error('invalid solidity type!: ' + type);
    }

    return solidityType;
};

/**
 * Should be used to transform plain bytes to SolidityParam object
 *
 * @method _bytesToParam
 * @param {Array} types of params
 * @param {String} bytes to be transformed to SolidityParam
 * @return {SolidityParam} SolidityParam for this group of params
 */
SolidityCoder.prototype._bytesToParam = function (types, bytes) {
    var self = this;
    var prefixTypes = types.reduce(function (acc, type) {
        return self._requireType(type).isVariadicType(type) ? acc + 1 : acc;
    }, 0);
    var valueTypes = types.length - prefixTypes;

    var prefix = bytes.slice(0, prefixTypes * 64);
    bytes = bytes.slice(prefixTypes * 64);
    var value = bytes.slice(0, valueTypes * 64);
    var suffix = bytes.slice(valueTypes * 64);
    return new SolidityParam(value, prefix, suffix); 
};

/**
 * Should be used to transform plain param of given type to SolidityParam
 *
 * @method _formatInput
 * @param {String} type of param
 * @param {Object} plain param
 * @return {SolidityParam}
 */
SolidityCoder.prototype._formatInput = function (type, param) {
    return this._requireType(type).formatInput(param, isArrayType(type));
};

/**
 * Should be used to encode plain param
 *
 * @method encodeParam
 * @param {String} type
 * @param {Object} plain param
 * @return {String} encoded plain param
 */
SolidityCoder.prototype.encodeParam = function (type, param) {
    return this._formatInput(type, param).encode();
};

/**
 * Should be used to encode list of params
 *
 * @method encodeParams
 * @param {Array} types
 * @param {Array} params
 * @return {String} encoded list of params
 */
SolidityCoder.prototype.encodeParams = function (types, params) {
    var self = this;
    return types.map(function (type, index) {
        return self._formatInput(type, params[index]);
    }).reduce(function (acc, solidityParam) {
        acc.append(solidityParam);
        return acc;
    }, new SolidityParam()).encode();
};

/**
 * Should be used to transform SolidityParam to plain param
 *
 * @method _formatOutput
 * @param {String} type
 * @param {SolidityParam} param
 * @return {Object} plain param
 */
SolidityCoder.prototype._formatOutput = function (type, param) {
    return this._requireType(type).formatOutput(param, isArrayType(type));
};

/**
 * Should be used to decode bytes to plain param
 *
 * @method decodeParam
 * @param {String} type
 * @param {String} bytes
 * @return {Object} plain param
 */
SolidityCoder.prototype.decodeParam = function (type, bytes) {
    return this._formatOutput(type, this._bytesToParam([type], bytes));
};

/**
 * Should be used to decode list of params
 *
 * @method decodeParam
 * @param {Array} types
 * @param {String} bytes
 * @return {Array} array of plain params
 */
SolidityCoder.prototype.decodeParams = function (types, bytes) {
    var self = this;
    var param = this._bytesToParam(types, bytes);
    return types.map(function (type) {
        var solidityType = self._requireType(type);
        var p = solidityType.shiftParam(type, param);
        return solidityType.formatOutput(p, isArrayType(type));
    });
};

var coder = new SolidityCoder([
    new SolidityType({
        name: 'address',
        match: 'strict',
        mode: 'value',
        inputFormatter: f.formatInputInt,
        outputFormatter: f.formatOutputAddress
    }),
    new SolidityType({
        name: 'bool',
        match: 'strict',
        mode: 'value',
        inputFormatter: f.formatInputBool,
        outputFormatter: f.formatOutputBool
    }),
    new SolidityType({
        name: 'int',
        match: 'prefix',
        mode: 'value',
        inputFormatter: f.formatInputInt,
        outputFormatter: f.formatOutputInt,
    }),
    new SolidityType({
        name: 'uint',
        match: 'prefix',
        mode: 'value',
        inputFormatter: f.formatInputInt,
        outputFormatter: f.formatOutputUInt
    }),
    new SolidityType({
        name: 'bytes',
        match: 'strict',
        mode: 'bytes',
        inputFormatter: f.formatInputDynamicBytes,
        outputFormatter: f.formatOutputDynamicBytes
    }),
    new SolidityType({
        name: 'bytes',
        match: 'prefix',
        mode: 'value',
        inputFormatter: f.formatInputBytes,
        outputFormatter: f.formatOutputBytes
    }),
    new SolidityType({
        name: 'real',
        match: 'prefix',
        mode: 'value',
        inputFormatter: f.formatInputReal,
        outputFormatter: f.formatOutputReal
    }),
    new SolidityType({
        name: 'ureal',
        match: 'prefix',
        mode: 'value',
        inputFormatter: f.formatInputReal,
        outputFormatter: f.formatOutputUReal
    })
]);

module.exports = coder;


},{"../utils/utils":8,"./formatters":3,"./param":4,"bignumber.js":"bignumber.js"}],3:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file formatters.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var BigNumber = require('bignumber.js');
var utils = require('../utils/utils');
var c = require('../utils/config');
var SolidityParam = require('./param');


/**
 * Formats input value to byte representation of int
 * If value is negative, return it's two's complement
 * If the value is floating point, round it down
 *
 * @method formatInputInt
 * @param {String|Number|BigNumber} value that needs to be formatted
 * @returns {SolidityParam}
 */
var formatInputInt = function (value) {
    var padding = c.ETH_PADDING * 2;
    BigNumber.config(c.ETH_BIGNUMBER_ROUNDING_MODE);
    var result = utils.padLeft(utils.toTwosComplement(value).round().toString(16), padding);
    return new SolidityParam(result);
};

/**
 * Formats input value to byte representation of string
 *
 * @method formatInputBytes
 * @param {String}
 * @returns {SolidityParam}
 */
var formatInputBytes = function (value) {
    var result = utils.fromAscii(value, c.ETH_PADDING).substr(2);
    return new SolidityParam(result);
};

/**
 * Formats input value to byte representation of string
 *
 * @method formatInputDynamicBytes
 * @param {String}
 * @returns {SolidityParam}
 */
var formatInputDynamicBytes = function (value) {
    var result = utils.fromAscii(value, c.ETH_PADDING).substr(2);
    return new SolidityParam('', formatInputInt(value.length).value, result);
};

/**
 * Formats input value to byte representation of bool
 *
 * @method formatInputBool
 * @param {Boolean}
 * @returns {SolidityParam}
 */
var formatInputBool = function (value) {
    var result = '000000000000000000000000000000000000000000000000000000000000000' + (value ?  '1' : '0');
    return new SolidityParam(result);
};

/**
 * Formats input value to byte representation of real
 * Values are multiplied by 2^m and encoded as integers
 *
 * @method formatInputReal
 * @param {String|Number|BigNumber}
 * @returns {SolidityParam}
 */
var formatInputReal = function (value) {
    return formatInputInt(new BigNumber(value).times(new BigNumber(2).pow(128)));
};

/**
 * Check if input value is negative
 *
 * @method signedIsNegative
 * @param {String} value is hex format
 * @returns {Boolean} true if it is negative, otherwise false
 */
var signedIsNegative = function (value) {
    return (new BigNumber(value.substr(0, 1), 16).toString(2).substr(0, 1)) === '1';
};

/**
 * Formats right-aligned output bytes to int
 *
 * @method formatOutputInt
 * @param {SolidityParam} param
 * @returns {BigNumber} right-aligned output bytes formatted to big number
 */
var formatOutputInt = function (param) {
    var value = param.value || "0";

    // check if it's negative number
    // it it is, return two's complement
    if (signedIsNegative(value)) {
        return new BigNumber(value, 16).minus(new BigNumber('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 16)).minus(1);
    }
    return new BigNumber(value, 16);
};

/**
 * Formats right-aligned output bytes to uint
 *
 * @method formatOutputUInt
 * @param {SolidityParam}
 * @returns {BigNumeber} right-aligned output bytes formatted to uint
 */
var formatOutputUInt = function (param) {
    var value = param.value || "0";
    return new BigNumber(value, 16);
};

/**
 * Formats right-aligned output bytes to real
 *
 * @method formatOutputReal
 * @param {SolidityParam}
 * @returns {BigNumber} input bytes formatted to real
 */
var formatOutputReal = function (param) {
    return formatOutputInt(param).dividedBy(new BigNumber(2).pow(128)); 
};

/**
 * Formats right-aligned output bytes to ureal
 *
 * @method formatOutputUReal
 * @param {SolidityParam}
 * @returns {BigNumber} input bytes formatted to ureal
 */
var formatOutputUReal = function (param) {
    return formatOutputUInt(param).dividedBy(new BigNumber(2).pow(128)); 
};

/**
 * Should be used to format output bool
 *
 * @method formatOutputBool
 * @param {SolidityParam}
 * @returns {Boolean} right-aligned input bytes formatted to bool
 */
var formatOutputBool = function (param) {
    return param.value === '0000000000000000000000000000000000000000000000000000000000000001' ? true : false;
};

/**
 * Should be used to format output string
 *
 * @method formatOutputBytes
 * @param {SolidityParam} left-aligned hex representation of string
 * @returns {String} ascii string
 */
var formatOutputBytes = function (param) {
    // length might also be important!
    return utils.toAscii(param.value);
};

/**
 * Should be used to format output string
 *
 * @method formatOutputDynamicBytes
 * @param {SolidityParam} left-aligned hex representation of string
 * @returns {String} ascii string
 */
var formatOutputDynamicBytes = function (param) {
    // length might also be important!
    return utils.toAscii(param.suffix);
};

/**
 * Should be used to format output address
 *
 * @method formatOutputAddress
 * @param {SolidityParam} right-aligned input bytes
 * @returns {String} address
 */
var formatOutputAddress = function (param) {
    var value = param.value;
    return "0x" + value.slice(value.length - 40, value.length);
};

module.exports = {
    formatInputInt: formatInputInt,
    formatInputBytes: formatInputBytes,
    formatInputDynamicBytes: formatInputDynamicBytes,
    formatInputBool: formatInputBool,
    formatInputReal: formatInputReal,
    formatOutputInt: formatOutputInt,
    formatOutputUInt: formatOutputUInt,
    formatOutputReal: formatOutputReal,
    formatOutputUReal: formatOutputUReal,
    formatOutputBool: formatOutputBool,
    formatOutputBytes: formatOutputBytes,
    formatOutputDynamicBytes: formatOutputDynamicBytes,
    formatOutputAddress: formatOutputAddress
};


},{"../utils/config":7,"../utils/utils":8,"./param":4,"bignumber.js":"bignumber.js"}],4:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file param.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

/**
 * SolidityParam object prototype.
 * Should be used when encoding, decoding solidity bytes
 */
var SolidityParam = function (value, prefix, suffix) {
    this.prefix = prefix || '';
    this.value = value || '';
    this.suffix = suffix || '';
};

/**
 * This method should be used to encode two params one after another
 *
 * @method append
 * @param {SolidityParam} param that it appended after this
 */
SolidityParam.prototype.append = function (param) {
    this.prefix += param.prefix;
    this.value += param.value;
    this.suffix += param.suffix;
};

/**
 * This method should be used to encode next param in an array
 *
 * @method appendArrayElement
 * @param {SolidityParam} param that is appended to an array
 */
SolidityParam.prototype.appendArrayElement = function (param) {
    this.suffix += param.value;
    this.prefix += param.prefix;
    // TODO: suffix not supported = it's required for nested arrays;
};

/**
 * This method should be used to create bytearrays from param
 *
 * @method encode
 * @return {String} encoded param(s)
 */
SolidityParam.prototype.encode = function () {
    return this.prefix + this.value + this.suffix;
};

/**
 * This method should be used to shift first param from group of params
 *
 * @method shiftValue
 * @return {SolidityParam} first value param
 */
SolidityParam.prototype.shiftValue = function () {
    var value = this.value.slice(0, 64);
    this.value = this.value.slice(64);
    return new SolidityParam(value);
};

/**
 * This method should be used to first bytes param from group of params
 *
 * @method shiftBytes
 * @return {SolidityParam} first bytes param
 */
SolidityParam.prototype.shiftBytes = function () {
    return this.shiftArray(1);   
};

/**
 * This method should be used to shift an array from group of params 
 * 
 * @method shiftArray
 * @param {Number} size of an array to shift
 * @return {SolidityParam} first array param
 */
SolidityParam.prototype.shiftArray = function (length) {
    var prefix = this.prefix.slice(0, 64);
    this.prefix = this.value.slice(64);
    var suffix = this.suffix.slice(0, 64 * length);
    this.suffix = this.suffix.slice(64 * length);
    return new SolidityParam('', prefix, suffix);
};

module.exports = SolidityParam;


},{}],5:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @file utils.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

/**
 * Returns the contstructor with matching number of arguments
 *
 * @method getConstructor
 * @param {Array} abi
 * @param {Number} numberOfArgs
 * @returns {Object} constructor function abi
 */
var getConstructor = function (abi, numberOfArgs) {
    return abi.filter(function (f) {
        return f.type === 'constructor' && f.inputs.length === numberOfArgs;
    })[0];
};

module.exports = {
    getConstructor: getConstructor
};


},{}],6:[function(require,module,exports){
'use strict';

// go env doesn't have and need XMLHttpRequest
if (typeof XMLHttpRequest === 'undefined') {
    exports.XMLHttpRequest = {};
} else {
    exports.XMLHttpRequest = XMLHttpRequest; // jshint ignore:line
}


},{}],7:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file config.js
 * @authors:
 *   Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

/**
 * Utils
 * 
 * @module utils
 */

/**
 * Utility functions
 * 
 * @class [utils] config
 * @constructor
 */

/// required to define ETH_BIGNUMBER_ROUNDING_MODE
var BigNumber = require('bignumber.js');

var ETH_UNITS = [ 
    'wei', 
    'Kwei', 
    'Mwei', 
    'Gwei', 
    'szabo', 
    'finney', 
    'ether', 
    'grand', 
    'Mether', 
    'Gether', 
    'Tether', 
    'Pether', 
    'Eether', 
    'Zether', 
    'Yether', 
    'Nether', 
    'Dether', 
    'Vether', 
    'Uether' 
];

module.exports = {
    ETH_PADDING: 32,
    ETH_SIGNATURE_LENGTH: 4,
    ETH_UNITS: ETH_UNITS,
    ETH_BIGNUMBER_ROUNDING_MODE: { ROUNDING_MODE: BigNumber.ROUND_DOWN },
    ETH_POLLING_TIMEOUT: 1000,
    defaultBlock: 'latest',
    defaultAccount: undefined
};


},{"bignumber.js":"bignumber.js"}],8:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file utils.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

/**
 * Utils
 * 
 * @module utils
 */

/**
 * Utility functions
 * 
 * @class [utils] utils
 * @constructor
 */

var BigNumber = require('bignumber.js');

var unitMap = {
    'wei':      '1',
    'kwei':     '1000',
    'ada':      '1000',
    'mwei':     '1000000',
    'babbage':  '1000000',
    'gwei':     '1000000000',
    'shannon':  '1000000000',
    'szabo':    '1000000000000',
    'finney':   '1000000000000000',
    'ether':    '1000000000000000000',
    'kether':   '1000000000000000000000',
    'grand':    '1000000000000000000000',
    'einstein': '1000000000000000000000',
    'mether':   '1000000000000000000000000',
    'gether':   '1000000000000000000000000000',
    'tether':   '1000000000000000000000000000000'
};

/**
 * Should be called to pad string to expected length
 *
 * @method padLeft
 * @param {String} string to be padded
 * @param {Number} characters that result string should have
 * @param {String} sign, by default 0
 * @returns {String} right aligned string
 */
var padLeft = function (string, chars, sign) {
    return new Array(chars - string.length + 1).join(sign ? sign : "0") + string;
};

/** 
 * Should be called to get sting from it's hex representation
 *
 * @method toAscii
 * @param {String} string in hex
 * @returns {String} ascii string representation of hex value
 */
var toAscii = function(hex) {
// Find termination
    var str = "";
    var i = 0, l = hex.length;
    if (hex.substring(0, 2) === '0x') {
        i = 2;
    }
    for (; i < l; i+=2) {
        var code = parseInt(hex.substr(i, 2), 16);
        if (code === 0) {
            break;
        }

        str += String.fromCharCode(code);
    }

    return str;
};
    
/**
 * Shold be called to get hex representation (prefixed by 0x) of ascii string 
 *
 * @method toHexNative
 * @param {String} string
 * @returns {String} hex representation of input string
 */
var toHexNative = function(str) {
    var hex = "";
    for(var i = 0; i < str.length; i++) {
        var n = str.charCodeAt(i).toString(16);
        hex += n.length < 2 ? '0' + n : n;
    }

    return hex;
};

/**
 * Shold be called to get hex representation (prefixed by 0x) of ascii string 
 *
 * @method fromAscii
 * @param {String} string
 * @param {Number} optional padding
 * @returns {String} hex representation of input string
 */
var fromAscii = function(str, pad) {
    pad = pad === undefined ? 0 : pad;
    var hex = toHexNative(str);
    while (hex.length < pad*2)
        hex += "00";
    return "0x" + hex;
};

/**
 * Should be used to create full function/event name from json abi
 *
 * @method transformToFullName
 * @param {Object} json-abi
 * @return {String} full fnction/event name
 */
var transformToFullName = function (json) {
    if (json.name.indexOf('(') !== -1) {
        return json.name;
    }

    var typeName = json.inputs.map(function(i){return i.type; }).join();
    return json.name + '(' + typeName + ')';
};

/**
 * Should be called to get display name of contract function
 * 
 * @method extractDisplayName
 * @param {String} name of function/event
 * @returns {String} display name for function/event eg. multiply(uint256) -> multiply
 */
var extractDisplayName = function (name) {
    var length = name.indexOf('('); 
    return length !== -1 ? name.substr(0, length) : name;
};

/// @returns overloaded part of function/event name
var extractTypeName = function (name) {
    /// TODO: make it invulnerable
    var length = name.indexOf('(');
    return length !== -1 ? name.substr(length + 1, name.length - 1 - (length + 1)).replace(' ', '') : "";
};

/**
 * Converts value to it's decimal representation in string
 *
 * @method toDecimal
 * @param {String|Number|BigNumber}
 * @return {String}
 */
var toDecimal = function (value) {
    return toBigNumber(value).toNumber();
};

/**
 * Converts value to it's hex representation
 *
 * @method fromDecimal
 * @param {String|Number|BigNumber}
 * @return {String}
 */
var fromDecimal = function (value) {
    var number = toBigNumber(value);
    var result = number.toString(16);

    return number.lessThan(0) ? '-0x' + result.substr(1) : '0x' + result;
};

/**
 * Auto converts any given value into it's hex representation.
 *
 * And even stringifys objects before.
 *
 * @method toHex
 * @param {String|Number|BigNumber|Object}
 * @return {String}
 */
var toHex = function (val) {
    /*jshint maxcomplexity:7 */

    if (isBoolean(val))
        return fromDecimal(+val);

    if (isBigNumber(val))
        return fromDecimal(val);

    if (isObject(val))
        return fromAscii(JSON.stringify(val));

    // if its a negative number, pass it through fromDecimal
    if (isString(val)) {
        if (val.indexOf('-0x') === 0)
           return fromDecimal(val);
        else if (!isFinite(val))
            return fromAscii(val);
    }

    return fromDecimal(val);
};

/**
 * Returns value of unit in Wei
 *
 * @method getValueOfUnit
 * @param {String} unit the unit to convert to, default ether
 * @returns {BigNumber} value of the unit (in Wei)
 * @throws error if the unit is not correct:w
 */
var getValueOfUnit = function (unit) {
    unit = unit ? unit.toLowerCase() : 'ether';
    var unitValue = unitMap[unit];
    if (unitValue === undefined) {
        throw new Error('This unit doesn\'t exists, please use the one of the following units' + JSON.stringify(unitMap, null, 2));
    }
    return new BigNumber(unitValue, 10);
};

/**
 * Takes a number of wei and converts it to any other ether unit.
 *
 * Possible units are:
 * - kwei/ada
 * - mwei/babbage
 * - gwei/shannon
 * - szabo
 * - finney
 * - ether
 * - kether/grand/einstein
 * - mether
 * - gether
 * - tether
 *
 * @method fromWei
 * @param {Number|String} number can be a number, number string or a HEX of a decimal
 * @param {String} unit the unit to convert to, default ether
 * @return {String|Object} When given a BigNumber object it returns one as well, otherwise a number
*/
var fromWei = function(number, unit) {
    var returnValue = toBigNumber(number).dividedBy(getValueOfUnit(unit));

    return isBigNumber(number) ? returnValue : returnValue.toString(10); 
};

/**
 * Takes a number of a unit and converts it to wei.
 *
 * Possible units are:
 * - kwei/ada
 * - mwei/babbage
 * - gwei/shannon
 * - szabo
 * - finney
 * - ether
 * - kether/grand/einstein
 * - mether
 * - gether
 * - tether
 *
 * @method toWei
 * @param {Number|String|BigNumber} number can be a number, number string or a HEX of a decimal
 * @param {String} unit the unit to convert from, default ether
 * @return {String|Object} When given a BigNumber object it returns one as well, otherwise a number
*/
var toWei = function(number, unit) {
    var returnValue = toBigNumber(number).times(getValueOfUnit(unit));

    return isBigNumber(number) ? returnValue : returnValue.toString(10); 
};

/**
 * Takes an input and transforms it into an bignumber
 *
 * @method toBigNumber
 * @param {Number|String|BigNumber} a number, string, HEX string or BigNumber
 * @return {BigNumber} BigNumber
*/
var toBigNumber = function(number) {
    /*jshint maxcomplexity:5 */
    number = number || 0;
    if (isBigNumber(number))
        return number;

    if (isString(number) && (number.indexOf('0x') === 0 || number.indexOf('-0x') === 0)) {
        return new BigNumber(number.replace('0x',''), 16);
    }
   
    return new BigNumber(number.toString(10), 10);
};

/**
 * Takes and input transforms it into bignumber and if it is negative value, into two's complement
 *
 * @method toTwosComplement
 * @param {Number|String|BigNumber}
 * @return {BigNumber}
 */
var toTwosComplement = function (number) {
    var bigNumber = toBigNumber(number);
    if (bigNumber.lessThan(0)) {
        return new BigNumber("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", 16).plus(bigNumber).plus(1);
    }
    return bigNumber;
};

/**
 * Checks if the given string is strictly an address
 *
 * @method isStrictAddress
 * @param {String} address the given HEX adress
 * @return {Boolean}
*/
var isStrictAddress = function (address) {
    return /^0x[0-9a-f]{40}$/.test(address);
};

/**
 * Checks if the given string is an address
 *
 * @method isAddress
 * @param {String} address the given HEX adress
 * @return {Boolean}
*/
var isAddress = function (address) {
    return /^(0x)?[0-9a-f]{40}$/.test(address);
};

/**
 * Transforms given string to valid 20 bytes-length addres with 0x prefix
 *
 * @method toAddress
 * @param {String} address
 * @return {String} formatted address
 */
var toAddress = function (address) {
    if (isStrictAddress(address)) {
        return address;
    }
    
    if (/^[0-9a-f]{40}$/.test(address)) {
        return '0x' + address;
    }

    return '0x' + padLeft(toHex(address).substr(2), 40);
};

/**
 * Returns true if object is BigNumber, otherwise false
 *
 * @method isBigNumber
 * @param {Object}
 * @return {Boolean} 
 */
var isBigNumber = function (object) {
    return object instanceof BigNumber ||
        (object && object.constructor && object.constructor.name === 'BigNumber');
};

/**
 * Returns true if object is string, otherwise false
 * 
 * @method isString
 * @param {Object}
 * @return {Boolean}
 */
var isString = function (object) {
    return typeof object === 'string' ||
        (object && object.constructor && object.constructor.name === 'String');
};

/**
 * Returns true if object is function, otherwise false
 *
 * @method isFunction
 * @param {Object}
 * @return {Boolean}
 */
var isFunction = function (object) {
    return typeof object === 'function';
};

/**
 * Returns true if object is Objet, otherwise false
 *
 * @method isObject
 * @param {Object}
 * @return {Boolean}
 */
var isObject = function (object) {
    return typeof object === 'object';
};

/**
 * Returns true if object is boolean, otherwise false
 *
 * @method isBoolean
 * @param {Object}
 * @return {Boolean}
 */
var isBoolean = function (object) {
    return typeof object === 'boolean';
};

/**
 * Returns true if object is array, otherwise false
 *
 * @method isArray
 * @param {Object}
 * @return {Boolean}
 */
var isArray = function (object) {
    return object instanceof Array; 
};

/**
 * Returns true if given string is valid json object
 * 
 * @method isJson
 * @param {String}
 * @return {Boolean}
 */
var isJson = function (str) {
    try {
        return !!JSON.parse(str);
    } catch (e) {
        return false;
    }
};

module.exports = {
    padLeft: padLeft,
    toHex: toHex,
    toDecimal: toDecimal,
    fromDecimal: fromDecimal,
    toAscii: toAscii,
    fromAscii: fromAscii,
    transformToFullName: transformToFullName,
    extractDisplayName: extractDisplayName,
    extractTypeName: extractTypeName,
    toWei: toWei,
    fromWei: fromWei,
    toBigNumber: toBigNumber,
    toTwosComplement: toTwosComplement,
    toAddress: toAddress,
    isBigNumber: isBigNumber,
    isStrictAddress: isStrictAddress,
    isAddress: isAddress,
    isFunction: isFunction,
    isString: isString,
    isObject: isObject,
    isBoolean: isBoolean,
    isArray: isArray,
    isJson: isJson
};


},{"bignumber.js":"bignumber.js"}],9:[function(require,module,exports){
module.exports={
    "version": "0.3.3"
}

},{}],10:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file web3.js
 * @authors:
 *   Jeffrey Wilcke <jeff@ethdev.com>
 *   Marek Kotewicz <marek@ethdev.com>
 *   Marian Oancea <marian@ethdev.com>
 *   Fabian Vogelsteller <fabian@ethdev.com>
 *   Gav Wood <g@ethdev.com>
 * @date 2014
 */

var version = require('./version.json');
var net = require('./web3/net');
var eth = require('./web3/eth');
var db = require('./web3/db');
var shh = require('./web3/shh');
var watches = require('./web3/watches');
var Filter = require('./web3/filter');
var utils = require('./utils/utils');
var formatters = require('./web3/formatters');
var RequestManager = require('./web3/requestmanager');
var c = require('./utils/config');
var Method = require('./web3/method');
var Property = require('./web3/property');

var web3Methods = [
    new Method({
        name: 'sha3',
        call: 'web3_sha3',
        params: 1
    })
];

var web3Properties = [
    new Property({
        name: 'version.client',
        getter: 'web3_clientVersion'
    }),
    new Property({
        name: 'version.network',
        getter: 'net_version',
        inputFormatter: utils.toDecimal
    }),
    new Property({
        name: 'version.ethereum',
        getter: 'eth_protocolVersion',
        inputFormatter: utils.toDecimal
    }),
    new Property({
        name: 'version.whisper',
        getter: 'shh_version',
        inputFormatter: utils.toDecimal
    })
];

/// creates methods in a given object based on method description on input
/// setups api calls for these methods
var setupMethods = function (obj, methods) {
    methods.forEach(function (method) {
        method.attachToObject(obj);
    });
};

/// creates properties in a given object based on properties description on input
/// setups api calls for these properties
var setupProperties = function (obj, properties) {
    properties.forEach(function (property) {
        property.attachToObject(obj);
    });
};

/// setups web3 object, and it's in-browser executed methods
var web3 = {};
web3.providers = {};
web3.version = {};
web3.version.api = version.version;
web3.eth = {};

/*jshint maxparams:4 */
web3.eth.filter = function (fil, eventParams, options, formatter) {

    // if its event, treat it differently
    // TODO: simplify and remove
    if (fil._isEvent) {
        return fil(eventParams, options);
    }

    // what outputLogFormatter? that's wrong
    //return new Filter(fil, watches.eth(), formatters.outputLogFormatter);
    return new Filter(fil, watches.eth(), formatter || formatters.outputLogFormatter);
};
/*jshint maxparams:3 */

web3.shh = {};
web3.shh.filter = function (fil) {
    return new Filter(fil, watches.shh(), formatters.outputPostFormatter);
};
web3.net = {};
web3.db = {};
web3.setProvider = function (provider) {
    RequestManager.getInstance().setProvider(provider);
};
web3.reset = function () {
    RequestManager.getInstance().reset();
    c.defaultBlock = 'latest';
    c.defaultAccount = undefined;
};
web3.toHex = utils.toHex;
web3.toAscii = utils.toAscii;
web3.fromAscii = utils.fromAscii;
web3.toDecimal = utils.toDecimal;
web3.fromDecimal = utils.fromDecimal;
web3.toBigNumber = utils.toBigNumber;
web3.toWei = utils.toWei;
web3.fromWei = utils.fromWei;
web3.isAddress = utils.isAddress;

// ADD defaultblock
Object.defineProperty(web3.eth, 'defaultBlock', {
    get: function () {
        return c.defaultBlock;
    },
    set: function (val) {
        c.defaultBlock = val;
        return val;
    }
});

Object.defineProperty(web3.eth, 'defaultAccount', {
    get: function () {
        return c.defaultAccount;
    },
    set: function (val) {
        c.defaultAccount = val;
        return val;
    }
});

/// setups all api methods
setupMethods(web3, web3Methods);
setupProperties(web3, web3Properties);
setupMethods(web3.net, net.methods);
setupProperties(web3.net, net.properties);
setupMethods(web3.eth, eth.methods);
setupProperties(web3.eth, eth.properties);
setupMethods(web3.db, db.methods);
setupMethods(web3.shh, shh.methods);

module.exports = web3;


},{"./utils/config":7,"./utils/utils":8,"./version.json":9,"./web3/db":12,"./web3/eth":14,"./web3/filter":16,"./web3/formatters":17,"./web3/method":21,"./web3/net":22,"./web3/property":23,"./web3/requestmanager":25,"./web3/shh":26,"./web3/watches":27}],11:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file contract.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2014
 */

var web3 = require('../web3'); 
var solAbi = require('../solidity/abi');
var utils = require('../utils/utils');
var SolidityEvent = require('./event');
var SolidityFunction = require('./function');

var addFunctionsToContract = function (contract, desc) {
    desc.filter(function (json) {
        return json.type === 'function';
    }).map(function (json) {
        return new SolidityFunction(json, contract.address);
    }).forEach(function (f) {
        f.attachToContract(contract);
    });
};

var addEventsToContract = function (contract, desc) {
    desc.filter(function (json) {
        return json.type === 'event';
    }).map(function (json) {
        return new SolidityEvent(json, contract.address);
    }).forEach(function (e) {
        e.attachToContract(contract);
    });
};

/**
 * This method should be called when we want to call / transact some solidity method from javascript
 * it returns an object which has same methods available as solidity contract description
 * usage example: 
 *
 * var abi = [{
 *      name: 'myMethod',
 *      inputs: [{ name: 'a', type: 'string' }],
 *      outputs: [{name: 'd', type: 'string' }]
 * }];  // contract abi
 *
 * var MyContract = web3.eth.contract(abi); // creation of contract prototype
 *
 * var contractInstance = new MyContract('0x0123123121');
 *
 * contractInstance.myMethod('this is test string param for call'); // myMethod call (implicit, default)
 * contractInstance.call().myMethod('this is test string param for call'); // myMethod call (explicit)
 * contractInstance.sendTransaction().myMethod('this is test string param for transact'); // myMethod sendTransaction
 *
 * @param abi - abi json description of the contract, which is being created
 * @returns contract object
 */
var contract = function (abi) {

    // return prototype
    return Contract.bind(null, abi);
};

var Contract = function (abi, options) {

    this.address = '';
    if (utils.isAddress(options)) {
        this.address = options;
    } else { // is an object!
        // TODO, parse the rest of the args
        options = options || {};
        var args = Array.prototype.slice.call(arguments, 2);
        var bytes = solAbi.formatConstructorParams(abi, args);
        options.data += bytes;
        this.address = web3.eth.sendTransaction(options);
    }

    addFunctionsToContract(this, abi);
    addEventsToContract(this, abi);
};

Contract.prototype.call = function () {
    console.error('contract.call is deprecated');
    return this;
};

Contract.prototype.sendTransaction = function () {
    console.error('contract.sendTransact is deprecated');
    return this;
};

module.exports = contract;


},{"../solidity/abi":1,"../utils/utils":8,"../web3":10,"./event":15,"./function":18}],12:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file db.js
 * @authors:
 *   Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var Method = require('./method');

var putString = new Method({
    name: 'putString',
    call: 'db_putString',
    params: 3
});


var getString = new Method({
    name: 'getString',
    call: 'db_getString',
    params: 2
});

var putHex = new Method({
    name: 'putHex',
    call: 'db_putHex',
    params: 3
});

var getHex = new Method({
    name: 'getHex',
    call: 'db_getHex',
    params: 2
});

var methods = [
    putString, getString, putHex, getHex
];

module.exports = {
    methods: methods
};

},{"./method":21}],13:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file errors.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

module.exports = {
    InvalidNumberOfParams: function () {
        return new Error('Invalid number of input parameters');
    },
    InvalidConnection: function (host){
        return new Error('CONNECTION ERROR: Couldn\'t connect to node '+ host +', is it running?');
    },
    InvalidProvider: function () {
        return new Error('Providor not set or invalid');
    },
    InvalidResponse: function (result){
        var message = !!result && !!result.error && !!result.error.message ? result.error.message : 'Invalid JSON RPC response';
        return new Error(message);
    }
};


},{}],14:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @file eth.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @author Fabian Vogelsteller <fabian@ethdev.com>
 * @date 2015
 */

/**
 * Web3
 * 
 * @module web3
 */

/**
 * Eth methods and properties
 *
 * An example method object can look as follows:
 *
 *      {
 *      name: 'getBlock',
 *      call: blockCall,
 *      params: 2,
 *      outputFormatter: formatters.outputBlockFormatter,
 *      inputFormatter: [ // can be a formatter funciton or an array of functions. Where each item in the array will be used for one parameter
 *           utils.toHex, // formats paramter 1
 *           function(param){ return !!param; } // formats paramter 2
 *         ]
 *       },
 *
 * @class [web3] eth
 * @constructor
 */

"use strict";

var formatters = require('./formatters');
var utils = require('../utils/utils');
var Method = require('./method');
var Property = require('./property');

var blockCall = function (args) {
    return (utils.isString(args[0]) && args[0].indexOf('0x') === 0) ? "eth_getBlockByHash" : "eth_getBlockByNumber";
};

var transactionFromBlockCall = function (args) {
    return (utils.isString(args[0]) && args[0].indexOf('0x') === 0) ? 'eth_getTransactionByBlockHashAndIndex' : 'eth_getTransactionByBlockNumberAndIndex';
};

var uncleCall = function (args) {
    return (utils.isString(args[0]) && args[0].indexOf('0x') === 0) ? 'eth_getUncleByBlockHashAndIndex' : 'eth_getUncleByBlockNumberAndIndex';
};

var getBlockTransactionCountCall = function (args) {
    return (utils.isString(args[0]) && args[0].indexOf('0x') === 0) ? 'eth_getBlockTransactionCountByHash' : 'eth_getBlockTransactionCountByNumber';
};

var uncleCountCall = function (args) {
    return (utils.isString(args[0]) && args[0].indexOf('0x') === 0) ? 'eth_getUncleCountByBlockHash' : 'eth_getUncleCountByBlockNumber';
};

/// @returns an array of objects describing web3.eth api methods

var getBalance = new Method({
    name: 'getBalance', 
    call: 'eth_getBalance', 
    params: 2,
    inputFormatter: [utils.toAddress, formatters.inputDefaultBlockNumberFormatter],
    outputFormatter: formatters.outputBigNumberFormatter
});

var getStorageAt = new Method({
    name: 'getStorageAt', 
    call: 'eth_getStorageAt', 
    params: 3,
    inputFormatter: [null, utils.toHex, formatters.inputDefaultBlockNumberFormatter]
});

var getCode = new Method({
    name: 'getCode',
    call: 'eth_getCode',
    params: 2,
    inputFormatter: [utils.toAddress, formatters.inputDefaultBlockNumberFormatter]
});

var getBlock = new Method({
    name: 'getBlock', 
    call: blockCall,
    params: 2,
    inputFormatter: [formatters.inputBlockNumberFormatter, function (val) { return !!val; }],
    outputFormatter: formatters.outputBlockFormatter
});

var getUncle = new Method({
    name: 'getUncle',
    call: uncleCall,
    params: 2,
    inputFormatter: [formatters.inputBlockNumberFormatter, utils.toHex],
    outputFormatter: formatters.outputBlockFormatter,

});

var getCompilers = new Method({
    name: 'getCompilers',
    call: 'eth_getCompilers',
    params: 0
});

var getBlockTransactionCount = new Method({
    name: 'getBlockTransactionCount',
    call: getBlockTransactionCountCall,
    params: 1,
    inputFormatter: [formatters.inputBlockNumberFormatter],
    outputFormatter: utils.toDecimal
});

var getBlockUncleCount = new Method({
    name: 'getBlockUncleCount',
    call: uncleCountCall,
    params: 1,
    inputFormatter: [formatters.inputBlockNumberFormatter],
    outputFormatter: utils.toDecimal
});

var getTransaction = new Method({
    name: 'getTransaction',
    call: 'eth_getTransactionByHash',
    params: 1,
    outputFormatter: formatters.outputTransactionFormatter
});

var getTransactionFromBlock = new Method({
    name: 'getTransactionFromBlock',
    call: transactionFromBlockCall,
    params: 2,
    inputFormatter: [formatters.inputBlockNumberFormatter, utils.toHex],
    outputFormatter: formatters.outputTransactionFormatter
});

var getTransactionCount = new Method({
    name: 'getTransactionCount',
    call: 'eth_getTransactionCount',
    params: 2,
    inputFormatter: [null, formatters.inputDefaultBlockNumberFormatter],
    outputFormatter: utils.toDecimal
});

var sendTransaction = new Method({
    name: 'sendTransaction',
    call: 'eth_sendTransaction',
    params: 1,
    inputFormatter: [formatters.inputTransactionFormatter]
});

var call = new Method({
    name: 'call',
    call: 'eth_call',
    params: 2,
    inputFormatter: [formatters.inputTransactionFormatter, formatters.inputDefaultBlockNumberFormatter]
});

var compileSolidity = new Method({
    name: 'compile.solidity',
    call: 'eth_compileSolidity',
    params: 1
});

var compileLLL = new Method({
    name: 'compile.lll',
    call: 'eth_compileLLL',
    params: 1
});

var compileSerpent = new Method({
    name: 'compile.serpent',
    call: 'eth_compileSerpent',
    params: 1
});

var methods = [
    getBalance,
    getStorageAt,
    getCode,
    getBlock,
    getUncle,
    getCompilers,
    getBlockTransactionCount,
    getBlockUncleCount,
    getTransaction,
    getTransactionFromBlock,
    getTransactionCount,
    call,
    sendTransaction,
    compileSolidity,
    compileLLL,
    compileSerpent,
];

/// @returns an array of objects describing web3.eth api properties



var properties = [
    new Property({
        name: 'coinbase',
        getter: 'eth_coinbase'
    }),
    new Property({
        name: 'mining',
        getter: 'eth_mining'
    }),
    new Property({
        name: 'gasPrice',
        getter: 'eth_gasPrice',
        outputFormatter: formatters.outputBigNumberFormatter
    }),
    new Property({
        name: 'accounts',
        getter: 'eth_accounts'
    }),
    new Property({
        name: 'blockNumber',
        getter: 'eth_blockNumber',
        outputFormatter: utils.toDecimal
    })
];

module.exports = {
    methods: methods,
    properties: properties
};


},{"../utils/utils":8,"./formatters":17,"./method":21,"./property":23}],15:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file event.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2014
 */

var utils = require('../utils/utils');
var coder = require('../solidity/coder');
var web3 = require('../web3');
var formatters = require('./formatters');

/**
 * This prototype should be used to create event filters
 */
var SolidityEvent = function (json, address) {
    this._params = json.inputs;
    this._name = utils.transformToFullName(json);
    this._address = address;
    this._anonymous = json.anonymous;
};

/**
 * Should be used to get filtered param types
 *
 * @method types
 * @param {Bool} decide if returned typed should be indexed
 * @return {Array} array of types
 */
SolidityEvent.prototype.types = function (indexed) {
    return this._params.filter(function (i) {
        return i.indexed === indexed;
    }).map(function (i) {
        return i.type;
    });
};

/**
 * Should be used to get event display name
 *
 * @method displayName
 * @return {String} event display name
 */
SolidityEvent.prototype.displayName = function () {
    return utils.extractDisplayName(this._name);
};

/**
 * Should be used to get event type name
 *
 * @method typeName
 * @return {String} event type name
 */
SolidityEvent.prototype.typeName = function () {
    return utils.extractTypeName(this._name);
};

/**
 * Should be used to get event signature
 *
 * @method signature
 * @return {String} event signature
 */
SolidityEvent.prototype.signature = function () {
    return web3.sha3(web3.fromAscii(this._name)).slice(2);
};

/**
 * Should be used to encode indexed params and options to one final object
 * 
 * @method encode
 * @param {Object} indexed
 * @param {Object} options
 * @return {Object} everything combined together and encoded
 */
SolidityEvent.prototype.encode = function (indexed, options) {
    indexed = indexed || {};
    options = options || {};
    var result = {};

    ['fromBlock', 'toBlock'].filter(function (f) {
        return options[f] !== undefined;
    }).forEach(function (f) {
        result[f] = utils.toHex(options[f]);
    });

    result.topics = [];

    if (!this._anonymous) {
        result.address = this._address;
        result.topics.push('0x' + this.signature());
    }

    var indexedTopics = this._params.filter(function (i) {
        return i.indexed === true;
    }).map(function (i) {
        var value = indexed[i.name];
        if (value === undefined || value === null) {
            return null;
        }
        
        if (utils.isArray(value)) {
            return value.map(function (v) {
                return '0x' + coder.encodeParam(i.type, v);
            });
        }
        return '0x' + coder.encodeParam(i.type, value);
    });

    result.topics = result.topics.concat(indexedTopics);

    return result;
};

/**
 * Should be used to decode indexed params and options
 *
 * @method decode
 * @param {Object} data
 * @return {Object} result object with decoded indexed && not indexed params
 */
SolidityEvent.prototype.decode = function (data) {
 
    data.data = data.data || '';
    data.topics = data.topics || [];

    var argTopics = this._anonymous ? data.topics : data.topics.slice(1);
    var indexedData = argTopics.map(function (topics) { return topics.slice(2); }).join("");
    var indexedParams = coder.decodeParams(this.types(true), indexedData); 

    var notIndexedData = data.data.slice(2);
    var notIndexedParams = coder.decodeParams(this.types(false), notIndexedData);
    
    var result = formatters.outputLogFormatter(data);
    result.event = this.displayName();
    result.address = data.address;

    result.args = this._params.reduce(function (acc, current) {
        acc[current.name] = current.indexed ? indexedParams.shift() : notIndexedParams.shift();
        return acc;
    }, {});

    delete result.data;
    delete result.topics;

    return result;
};

/**
 * Should be used to create new filter object from event
 *
 * @method execute
 * @param {Object} indexed
 * @param {Object} options
 * @return {Object} filter object
 */
SolidityEvent.prototype.execute = function (indexed, options) {
    var o = this.encode(indexed, options);
    var formatter = this.decode.bind(this);
    return web3.eth.filter(o, undefined, undefined, formatter);
};

/**
 * Should be used to attach event to contract object
 *
 * @method attachToContract
 * @param {Contract}
 */
SolidityEvent.prototype.attachToContract = function (contract) {
    var execute = this.execute.bind(this);
    var displayName = this.displayName();
    if (!contract[displayName]) {
        contract[displayName] = execute;
    }
    contract[displayName][this.typeName()] = this.execute.bind(this, contract);
};

module.exports = SolidityEvent;


},{"../solidity/coder":2,"../utils/utils":8,"../web3":10,"./formatters":17}],16:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file filter.js
 * @authors:
 *   Jeffrey Wilcke <jeff@ethdev.com>
 *   Marek Kotewicz <marek@ethdev.com>
 *   Marian Oancea <marian@ethdev.com>
 *   Fabian Vogelsteller <fabian@ethdev.com>
 *   Gav Wood <g@ethdev.com>
 * @date 2014
 */

var RequestManager = require('./requestmanager');
var formatters = require('./formatters');
var utils = require('../utils/utils');

/**
* Converts a given topic to a hex string, but also allows null values.
*
* @param {Mixed} value
* @return {String}
*/
var toTopic = function(value){

    if(value === null || typeof value === 'undefined')
        return null;

    value = String(value);

    if(value.indexOf('0x') === 0)
        return value;
    else
        return utils.fromAscii(value);
};

/// This method should be called on options object, to verify deprecated properties && lazy load dynamic ones
/// @param should be string or object
/// @returns options string or object
var getOptions = function (options) {

    if (utils.isString(options)) {
        return options;
    } 

    options = options || {};

    // make sure topics, get converted to hex
    options.topics = options.topics || [];
    options.topics = options.topics.map(function(topic){
        return (utils.isArray(topic)) ? topic.map(toTopic) : toTopic(topic);
    });

    // lazy load
    return {
        topics: options.topics,
        to: options.to,
        address: options.address,
        fromBlock: formatters.inputBlockNumberFormatter(options.fromBlock),
        toBlock: formatters.inputBlockNumberFormatter(options.toBlock) 
    }; 
};

var Filter = function (options, methods, formatter) {
    var implementation = {};
    methods.forEach(function (method) {
        method.attachToObject(implementation);
    });
    this.options = getOptions(options);
    this.implementation = implementation;
    this.callbacks = [];
    this.formatter = formatter;
    this.filterId = this.implementation.newFilter(this.options);
};

Filter.prototype.watch = function (callback) {
    this.callbacks.push(callback);
    var self = this;

    var onMessage = function (error, messages) {
        if (error) {
            return self.callbacks.forEach(function (callback) {
                callback(error);
            });
        }

        messages.forEach(function (message) {
            message = self.formatter ? self.formatter(message) : message;
            self.callbacks.forEach(function (callback) {
                callback(null, message);
            });
        });
    };

    // call getFilterLogs on start
    if (!utils.isString(this.options)) {
        this.get(function (err, messages) {
            // don't send all the responses to all the watches again... just to this one
            if (err) {
                callback(err);
            }

            messages.forEach(function (message) {
                callback(null, message);
            });
        });
    }

    RequestManager.getInstance().startPolling({
        method: this.implementation.poll.call,
        params: [this.filterId],
    }, this.filterId, onMessage, this.stopWatching.bind(this));
};

Filter.prototype.stopWatching = function () {
    RequestManager.getInstance().stopPolling(this.filterId);
    this.implementation.uninstallFilter(this.filterId);
    this.callbacks = [];
};

Filter.prototype.get = function (callback) {
    var self = this;
    if (utils.isFunction(callback)) {
        this.implementation.getLogs(this.filterId, function(err, res){
            if (err) {
                callback(err);
            } else {
                callback(null, res.map(function (log) {
                    return self.formatter ? self.formatter(log) : log;
                }));
            }
        });
    } else {
        var logs = this.implementation.getLogs(this.filterId);
        return logs.map(function (log) {
            return self.formatter ? self.formatter(log) : log;
        });
    }
};

module.exports = Filter;


},{"../utils/utils":8,"./formatters":17,"./requestmanager":25}],17:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file formatters.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @author Fabian Vogelsteller <fabian@ethdev.com>
 * @date 2015
 */

var utils = require('../utils/utils');
var config = require('../utils/config');

/**
 * Should the format output to a big number
 *
 * @method outputBigNumberFormatter
 * @param {String|Number|BigNumber}
 * @returns {BigNumber} object
 */
var outputBigNumberFormatter = function (number) {
    return utils.toBigNumber(number);
};

var isPredefinedBlockNumber = function (blockNumber) {
    return blockNumber === 'latest' || blockNumber === 'pending' || blockNumber === 'earliest';
};

var inputDefaultBlockNumberFormatter = function (blockNumber) {
    if (blockNumber === undefined) {
        return config.defaultBlock;
    }
    return inputBlockNumberFormatter(blockNumber);
};

var inputBlockNumberFormatter = function (blockNumber) {
    if (blockNumber === undefined) {
        return undefined;
    } else if (isPredefinedBlockNumber(blockNumber)) {
        return blockNumber;
    }
    return utils.toHex(blockNumber);
};

/**
 * Formats the input of a transaction and converts all values to HEX
 *
 * @method inputTransactionFormatter
 * @param {Object} transaction options
 * @returns object
*/
var inputTransactionFormatter = function (options){

    options.from = options.from || config.defaultAccount;

    // make code -> data
    if (options.code) {
        options.data = options.code;
        delete options.code;
    }

    ['gasPrice', 'gas', 'value'].filter(function (key) {
        return options[key] !== undefined;
    }).forEach(function(key){
        options[key] = utils.fromDecimal(options[key]);
    });

    return options; 
};

/**
 * Formats the output of a transaction to its proper values
 * 
 * @method outputTransactionFormatter
 * @param {Object} transaction
 * @returns {Object} transaction
*/
var outputTransactionFormatter = function (tx){
    tx.blockNumber = utils.toDecimal(tx.blockNumber);
    tx.transactionIndex = utils.toDecimal(tx.transactionIndex);
    tx.nonce = utils.toDecimal(tx.nonce);
    tx.gas = utils.toDecimal(tx.gas);
    tx.gasPrice = utils.toBigNumber(tx.gasPrice);
    tx.value = utils.toBigNumber(tx.value);
    return tx;
};

/**
 * Formats the output of a block to its proper values
 *
 * @method outputBlockFormatter
 * @param {Object} block object 
 * @returns {Object} block object
*/
var outputBlockFormatter = function(block) {

    // transform to number
    block.gasLimit = utils.toDecimal(block.gasLimit);
    block.gasUsed = utils.toDecimal(block.gasUsed);
    block.size = utils.toDecimal(block.size);
    block.timestamp = utils.toDecimal(block.timestamp);
    block.number = utils.toDecimal(block.number);

    block.difficulty = utils.toBigNumber(block.difficulty);
    block.totalDifficulty = utils.toBigNumber(block.totalDifficulty);

    if (utils.isArray(block.transactions)) {
        block.transactions.forEach(function(item){
            if(!utils.isString(item))
                return outputTransactionFormatter(item);
        });
    }

    return block;
};

/**
 * Formats the output of a log
 * 
 * @method outputLogFormatter
 * @param {Object} log object
 * @returns {Object} log
*/
var outputLogFormatter = function(log) {
    if (log === null) { // 'pending' && 'latest' filters are nulls
        return null;
    }

    log.blockNumber = utils.toDecimal(log.blockNumber);
    log.transactionIndex = utils.toDecimal(log.transactionIndex);
    log.logIndex = utils.toDecimal(log.logIndex);

    return log;
};

/**
 * Formats the input of a whisper post and converts all values to HEX
 *
 * @method inputPostFormatter
 * @param {Object} transaction object
 * @returns {Object}
*/
var inputPostFormatter = function(post) {

    post.payload = utils.toHex(post.payload);
    post.ttl = utils.fromDecimal(post.ttl);
    post.workToProve = utils.fromDecimal(post.workToProve);
    post.priority = utils.fromDecimal(post.priority);

    // fallback
    if (!utils.isArray(post.topics)) {
        post.topics = post.topics ? [post.topics] : [];
    }

    // format the following options
    post.topics = post.topics.map(function(topic){
        return utils.fromAscii(topic);
    });

    return post; 
};

/**
 * Formats the output of a received post message
 *
 * @method outputPostFormatter
 * @param {Object}
 * @returns {Object}
 */
var outputPostFormatter = function(post){

    post.expiry = utils.toDecimal(post.expiry);
    post.sent = utils.toDecimal(post.sent);
    post.ttl = utils.toDecimal(post.ttl);
    post.workProved = utils.toDecimal(post.workProved);
    post.payloadRaw = post.payload;
    post.payload = utils.toAscii(post.payload);

    if (utils.isJson(post.payload)) {
        post.payload = JSON.parse(post.payload);
    }

    // format the following options
    if (!post.topics) {
        post.topics = [];
    }
    post.topics = post.topics.map(function(topic){
        return utils.toAscii(topic);
    });

    return post;
};

module.exports = {
    inputDefaultBlockNumberFormatter: inputDefaultBlockNumberFormatter,
    inputBlockNumberFormatter: inputBlockNumberFormatter,
    inputTransactionFormatter: inputTransactionFormatter,
    inputPostFormatter: inputPostFormatter,
    outputBigNumberFormatter: outputBigNumberFormatter,
    outputTransactionFormatter: outputTransactionFormatter,
    outputBlockFormatter: outputBlockFormatter,
    outputLogFormatter: outputLogFormatter,
    outputPostFormatter: outputPostFormatter
};


},{"../utils/config":7,"../utils/utils":8}],18:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file function.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var web3 = require('../web3');
var coder = require('../solidity/coder');
var utils = require('../utils/utils');

/**
 * This prototype should be used to call/sendTransaction to solidity functions
 */
var SolidityFunction = function (json, address) {
    this._inputTypes = json.inputs.map(function (i) {
        return i.type;
    });
    this._outputTypes = json.outputs.map(function (i) {
        return i.type;
    });
    this._constant = json.constant;
    this._name = utils.transformToFullName(json);
    this._address = address;
};

/**
 * Should be used to create payload from arguments
 *
 * @method toPayload
 * @param {...} solidity function params
 * @param {Object} optional payload options
 */
SolidityFunction.prototype.toPayload = function () {
    var args = Array.prototype.slice.call(arguments);
    var options = {};
    if (args.length > this._inputTypes.length && utils.isObject(args[args.length -1])) {
        options = args.pop();
    }
    options.to = this._address;
    options.data = '0x' + this.signature() + coder.encodeParams(this._inputTypes, args);
    return options;
};

/**
 * Should be used to get function signature
 *
 * @method signature
 * @return {String} function signature
 */
SolidityFunction.prototype.signature = function () {
    return web3.sha3(web3.fromAscii(this._name)).slice(2, 10);
};

/**
 * Should be used to call function
 * 
 * @method call
 * @param {Object} options
 * @return {String} output bytes
 */
SolidityFunction.prototype.call = function () {
    var payload = this.toPayload.apply(this, Array.prototype.slice.call(arguments));
    var output = web3.eth.call(payload);
    output = output.length >= 2 ? output.slice(2) : output;
    var result = coder.decodeParams(this._outputTypes, output);
    return result.length === 1 ? result[0] : result;
};

/**
 * Should be used to sendTransaction to solidity function
 *
 * @method sendTransaction
 * @param {Object} options
 */
SolidityFunction.prototype.sendTransaction = function () {
    var payload = this.toPayload.apply(this, Array.prototype.slice.call(arguments));
    web3.eth.sendTransaction(payload);
};

/**
 * Should be used to get function display name
 *
 * @method displayName
 * @return {String} display name of the function
 */
SolidityFunction.prototype.displayName = function () {
    return utils.extractDisplayName(this._name);
};

/**
 * Should be used to get function type name
 * 
 * @method typeName
 * @return {String} type name of the function
 */
SolidityFunction.prototype.typeName = function () {
    return utils.extractTypeName(this._name);
};

/**
 * Should be called to execute function
 *
 * @method execute
 */
SolidityFunction.prototype.execute = function () {
    var transaction = !this._constant;
    
    // send transaction
    if (transaction) {
        return this.sendTransaction.apply(this, Array.prototype.slice.call(arguments));
    }

    // call
    return this.call.apply(this, Array.prototype.slice.call(arguments));
};

/**
 * Should be called to attach function to contract
 *
 * @method attachToContract
 * @param {Contract}
 */
SolidityFunction.prototype.attachToContract = function (contract) {
    var execute = this.execute.bind(this);
    execute.call = this.call.bind(this);
    execute.sendTransaction = this.sendTransaction.bind(this);
    var displayName = this.displayName();
    if (!contract[displayName]) {
        contract[displayName] = execute;
    }
    contract[displayName][this.typeName()] = execute; // circular!!!!
};

module.exports = SolidityFunction;


},{"../solidity/coder":2,"../utils/utils":8,"../web3":10}],19:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file httpprovider.js
 * @authors:
 *   Marek Kotewicz <marek@ethdev.com>
 *   Marian Oancea <marian@ethdev.com>
 *   Fabian Vogelsteller <fabian@ethdev.com>
 * @date 2014
 */

"use strict";

var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest; // jshint ignore:line
var errors = require('./errors');

var HttpProvider = function (host) {
    this.host = host || 'http://localhost:8545';
};

HttpProvider.prototype.send = function (payload) {
    var request = new XMLHttpRequest();

    request.open('POST', this.host, false);
    
    try {
        request.send(JSON.stringify(payload));
    } catch(error) {
        throw errors.InvalidConnection(this.host);
    }


    // check request.status
    // TODO: throw an error here! it cannot silently fail!!!
    //if (request.status !== 200) {
        //return;
    //}
    return JSON.parse(request.responseText);
};

HttpProvider.prototype.sendAsync = function (payload, callback) {
    var request = new XMLHttpRequest();
    request.onreadystatechange = function() {
        if (request.readyState === 4) {
            // TODO: handle the error properly here!!!
            callback(null, JSON.parse(request.responseText));
        }
    };

    request.open('POST', this.host, true);

    try {
        request.send(JSON.stringify(payload));
    } catch(error) {
        callback(errors.InvalidConnection(this.host));
    }
};

module.exports = HttpProvider;


},{"./errors":13,"xmlhttprequest":6}],20:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file jsonrpc.js
 * @authors:
 *   Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var Jsonrpc = function () {
    // singleton pattern
    if (arguments.callee._singletonInstance) {
        return arguments.callee._singletonInstance;
    }
    arguments.callee._singletonInstance = this;

    this.messageId = 1;
};

/**
 * @return {Jsonrpc} singleton
 */
Jsonrpc.getInstance = function () {
    var instance = new Jsonrpc();
    return instance;
};

/**
 * Should be called to valid json create payload object
 *
 * @method toPayload
 * @param {Function} method of jsonrpc call, required
 * @param {Array} params, an array of method params, optional
 * @returns {Object} valid jsonrpc payload object
 */
Jsonrpc.prototype.toPayload = function (method, params) {
    if (!method)
        console.error('jsonrpc method should be specified!');

    return {
        jsonrpc: '2.0',
        method: method,
        params: params || [],
        id: this.messageId++
    };
};

/**
 * Should be called to check if jsonrpc response is valid
 *
 * @method isValidResponse
 * @param {Object}
 * @returns {Boolean} true if response is valid, otherwise false
 */
Jsonrpc.prototype.isValidResponse = function (response) {
    return !!response &&
        !response.error &&
        response.jsonrpc === '2.0' &&
        typeof response.id === 'number' &&
        response.result !== undefined; // only undefined is not valid json object
};

/**
 * Should be called to create batch payload object
 *
 * @method toBatchPayload
 * @param {Array} messages, an array of objects with method (required) and params (optional) fields
 * @returns {Array} batch payload
 */
Jsonrpc.prototype.toBatchPayload = function (messages) {
    var self = this;
    return messages.map(function (message) {
        return self.toPayload(message.method, message.params);
    });
};

module.exports = Jsonrpc;


},{}],21:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @file method.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var RequestManager = require('./requestmanager');
var utils = require('../utils/utils');
var errors = require('./errors');

var Method = function (options) {
    this.name = options.name;
    this.call = options.call;
    this.params = options.params || 0;
    this.inputFormatter = options.inputFormatter;
    this.outputFormatter = options.outputFormatter;
};

/**
 * Should be used to determine name of the jsonrpc method based on arguments
 *
 * @method getCall
 * @param {Array} arguments
 * @return {String} name of jsonrpc method
 */
Method.prototype.getCall = function (args) {
    return utils.isFunction(this.call) ? this.call(args) : this.call;
};

/**
 * Should be used to extract callback from array of arguments. Modifies input param
 *
 * @method extractCallback
 * @param {Array} arguments
 * @return {Function|Null} callback, if exists
 */
Method.prototype.extractCallback = function (args) {
    if (utils.isFunction(args[args.length - 1])) {
        return args.pop(); // modify the args array!
    }
    return null;
};

/**
 * Should be called to check if the number of arguments is correct
 * 
 * @method validateArgs
 * @param {Array} arguments
 * @throws {Error} if it is not
 */
Method.prototype.validateArgs = function (args) {
    if (args.length !== this.params) {
        throw errors.InvalidNumberOfParams();
    }
};

/**
 * Should be called to format input args of method
 * 
 * @method formatInput
 * @param {Array}
 * @return {Array}
 */
Method.prototype.formatInput = function (args) {
    if (!this.inputFormatter) {
        return args;
    }

    return this.inputFormatter.map(function (formatter, index) {
        return formatter ? formatter(args[index]) : args[index];
    });
};

/**
 * Should be called to format output(result) of method
 *
 * @method formatOutput
 * @param {Object}
 * @return {Object}
 */
Method.prototype.formatOutput = function (result) {
    return this.outputFormatter && result !== null ? this.outputFormatter(result) : result;
};

/**
 * Should attach function to method
 * 
 * @method attachToObject
 * @param {Object}
 * @param {Function}
 */
Method.prototype.attachToObject = function (obj) {
    var func = this.send.bind(this);
    func.call = this.call; // that's ugly. filter.js uses it
    var name = this.name.split('.');
    if (name.length > 1) {
        obj[name[0]] = obj[name[0]] || {};
        obj[name[0]][name[1]] = func;
    } else {
        obj[name[0]] = func; 
    }
};

/**
 * Should create payload from given input args
 *
 * @method toPayload
 * @param {Array} args
 * @return {Object}
 */
Method.prototype.toPayload = function (args) {
    var call = this.getCall(args);
    var callback = this.extractCallback(args);
    var params = this.formatInput(args);
    this.validateArgs(params);

    return {
        method: call,
        params: params,
        callback: callback
    };
};

/**
 * Should send request to the API
 *
 * @method send
 * @param list of params
 * @return result
 */
Method.prototype.send = function () {
    var payload = this.toPayload(Array.prototype.slice.call(arguments));
    if (payload.callback) {
        var self = this;
        return RequestManager.getInstance().sendAsync(payload, function (err, result) {
            payload.callback(null, self.formatOutput(result));
        });
    }
    return this.formatOutput(RequestManager.getInstance().send(payload));
};

module.exports = Method;


},{"../utils/utils":8,"./errors":13,"./requestmanager":25}],22:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file eth.js
 * @authors:
 *   Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var utils = require('../utils/utils');
var Property = require('./property');

/// @returns an array of objects describing web3.eth api methods
var methods = [
];

/// @returns an array of objects describing web3.eth api properties
var properties = [
    new Property({
        name: 'listening',
        getter: 'net_listening'
    }),
    new Property({
        name: 'peerCount',
        getter: 'net_peerCount',
        outputFormatter: utils.toDecimal
    })
];


module.exports = {
    methods: methods,
    properties: properties
};


},{"../utils/utils":8,"./property":23}],23:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @file property.js
 * @author Fabian Vogelsteller <fabian@frozeman.de>
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var RequestManager = require('./requestmanager');

var Property = function (options) {
    this.name = options.name;
    this.getter = options.getter;
    this.setter = options.setter;
    this.outputFormatter = options.outputFormatter;
    this.inputFormatter = options.inputFormatter;
};

/**
 * Should be called to format input args of method
 * 
 * @method formatInput
 * @param {Array}
 * @return {Array}
 */
Property.prototype.formatInput = function (arg) {
    return this.inputFormatter ? this.inputFormatter(arg) : arg;
};

/**
 * Should be called to format output(result) of method
 *
 * @method formatOutput
 * @param {Object}
 * @return {Object}
 */
Property.prototype.formatOutput = function (result) {
    return this.outputFormatter && result !== null ? this.outputFormatter(result) : result;
};

/**
 * Should attach function to method
 * 
 * @method attachToObject
 * @param {Object}
 * @param {Function}
 */
Property.prototype.attachToObject = function (obj) {
    var proto = {
        get: this.get.bind(this),
        set: this.set.bind(this)
    };

    var name = this.name.split('.');
    if (name.length > 1) {
        obj[name[0]] = obj[name[0]] || {};
        Object.defineProperty(obj[name[0]], name[1], proto); 
    } else {
        Object.defineProperty(obj, name[0], proto);
    }
};

/**
 * Should be used to get value of the property
 *
 * @method get
 * @return {Object} value of the property
 */
Property.prototype.get = function () {
    return this.formatOutput(RequestManager.getInstance().send({
        method: this.getter
    }));
};

/**
 * Should be used to set value of the property
 *
 * @method set
 * @param {Object} new value of the property
 */
Property.prototype.set = function (value) {
    return RequestManager.getInstance().send({
        method: this.setter,
        params: [this.formatInput(value)]
    });
};

module.exports = Property;


},{"./requestmanager":25}],24:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file qtsync.js
 * @authors:
 *   Marek Kotewicz <marek@ethdev.com>
 *   Marian Oancea <marian@ethdev.com>
 * @date 2014
 */

var QtSyncProvider = function () {
};

QtSyncProvider.prototype.send = function (payload) {
    var result = navigator.qt.callMethod(JSON.stringify(payload));
    return JSON.parse(result);
};

module.exports = QtSyncProvider;


},{}],25:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** 
 * @file requestmanager.js
 * @author Jeffrey Wilcke <jeff@ethdev.com>
 * @author Marek Kotewicz <marek@ethdev.com>
 * @author Marian Oancea <marian@ethdev.com>
 * @author Fabian Vogelsteller <fabian@ethdev.com>
 * @author Gav Wood <g@ethdev.com>
 * @date 2014
 */

var Jsonrpc = require('./jsonrpc');
var utils = require('../utils/utils');
var c = require('../utils/config');
var errors = require('./errors');

/**
 * It's responsible for passing messages to providers
 * It's also responsible for polling the ethereum node for incoming messages
 * Default poll timeout is 1 second
 * Singleton
 */
var RequestManager = function (provider) {
    // singleton pattern
    if (arguments.callee._singletonInstance) {
        return arguments.callee._singletonInstance;
    }
    arguments.callee._singletonInstance = this;

    this.provider = provider;
    this.polls = [];
    this.timeout = null;
    this.poll();
};

/**
 * @return {RequestManager} singleton
 */
RequestManager.getInstance = function () {
    var instance = new RequestManager();
    return instance;
};

/**
 * Should be used to synchronously send request
 *
 * @method send
 * @param {Object} data
 * @return {Object}
 */
RequestManager.prototype.send = function (data) {
    if (!this.provider) {
        console.error(errors.InvalidProvider());
        return null;
    }

    var payload = Jsonrpc.getInstance().toPayload(data.method, data.params);
    var result = this.provider.send(payload);

    if (!Jsonrpc.getInstance().isValidResponse(result)) {
        throw errors.InvalidResponse(result);
    }

    return result.result;
};

/**
 * Should be used to asynchronously send request
 *
 * @method sendAsync
 * @param {Object} data
 * @param {Function} callback
 */
RequestManager.prototype.sendAsync = function (data, callback) {
    if (!this.provider) {
        return callback(errors.InvalidProvider());
    }

    var payload = Jsonrpc.getInstance().toPayload(data.method, data.params);
    this.provider.sendAsync(payload, function (err, result) {
        if (err) {
            return callback(err);
        }
        
        if (!Jsonrpc.getInstance().isValidResponse(result)) {
            return callback(errors.InvalidResponse(result));
        }

        callback(null, result.result);
    });
};

/**
 * Should be used to set provider of request manager
 *
 * @method setProvider
 * @param {Object}
 */
RequestManager.prototype.setProvider = function (p) {
    this.provider = p;
};

/*jshint maxparams:4 */

/**
 * Should be used to start polling
 *
 * @method startPolling
 * @param {Object} data
 * @param {Number} pollId
 * @param {Function} callback
 * @param {Function} uninstall
 *
 * @todo cleanup number of params
 */
RequestManager.prototype.startPolling = function (data, pollId, callback, uninstall) {
    this.polls.push({data: data, id: pollId, callback: callback, uninstall: uninstall});
};
/*jshint maxparams:3 */

/**
 * Should be used to stop polling for filter with given id
 *
 * @method stopPolling
 * @param {Number} pollId
 */
RequestManager.prototype.stopPolling = function (pollId) {
    for (var i = this.polls.length; i--;) {
        var poll = this.polls[i];
        if (poll.id === pollId) {
            this.polls.splice(i, 1);
        }
    }
};

/**
 * Should be called to reset polling mechanism of request manager
 *
 * @method reset
 */
RequestManager.prototype.reset = function () {
    this.polls.forEach(function (poll) {
        poll.uninstall(poll.id); 
    });
    this.polls = [];

    if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = null;
    }
    this.poll();
};

/**
 * Should be called to poll for changes on filter with given id
 *
 * @method poll
 */
RequestManager.prototype.poll = function () {
    this.timeout = setTimeout(this.poll.bind(this), c.ETH_POLLING_TIMEOUT);

    if (!this.polls.length) {
        return;
    }

    if (!this.provider) {
        console.error(errors.InvalidProvider());
        return;
    }

    var payload = Jsonrpc.getInstance().toBatchPayload(this.polls.map(function (data) {
        return data.data;
    }));

    var self = this;
    this.provider.sendAsync(payload, function (error, results) {
        // TODO: console log?
        if (error) {
            return;
        }
            
        if (!utils.isArray(results)) {
            throw errors.InvalidResponse(results);
        }

        results.map(function (result, index) {
            result.callback = self.polls[index].callback;
            return result;
        }).filter(function (result) {
            var valid = Jsonrpc.getInstance().isValidResponse(result);
            if (!valid) {
                result.callback(errors.InvalidResponse(result));
            }
            return valid;
        }).filter(function (result) {
            return utils.isArray(result.result) && result.result.length > 0;
        }).forEach(function (result) {
            result.callback(null, result.result);
        });
    });
};

module.exports = RequestManager;


},{"../utils/config":7,"../utils/utils":8,"./errors":13,"./jsonrpc":20}],26:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file shh.js
 * @authors:
 *   Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var Method = require('./method');
var formatters = require('./formatters');

var post = new Method({
    name: 'post', 
    call: 'shh_post', 
    params: 1,
    inputFormatter: [formatters.inputPostFormatter]
});

var newIdentity = new Method({
    name: 'newIdentity',
    call: 'shh_newIdentity',
    params: 0
});

var hasIdentity = new Method({
    name: 'hasIdentity',
    call: 'shh_hasIdentity',
    params: 1
});

var newGroup = new Method({
    name: 'newGroup',
    call: 'shh_newGroup',
    params: 0
});

var addToGroup = new Method({
    name: 'addToGroup',
    call: 'shh_addToGroup',
    params: 0
});

var methods = [
    post,
    newIdentity,
    hasIdentity,
    newGroup,
    addToGroup
];

module.exports = {
    methods: methods
};


},{"./formatters":17,"./method":21}],27:[function(require,module,exports){
/*
    This file is part of ethereum.js.

    ethereum.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    ethereum.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with ethereum.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file watches.js
 * @authors:
 *   Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var Method = require('./method');

/// @returns an array of objects describing web3.eth.filter api methods
var eth = function () {
    var newFilterCall = function (args) {
        return typeof args[0] === 'string' ? 'eth_newBlockFilter' : 'eth_newFilter';
    };

    var newFilter = new Method({
        name: 'newFilter',
        call: newFilterCall,
        params: 1
    });

    var uninstallFilter = new Method({
        name: 'uninstallFilter',
        call: 'eth_uninstallFilter',
        params: 1
    });

    var getLogs = new Method({
        name: 'getLogs',
        call: 'eth_getFilterLogs',
        params: 1
    });

    var poll = new Method({
        name: 'poll',
        call: 'eth_getFilterChanges',
        params: 1
    });

    return [
        newFilter,
        uninstallFilter,
        getLogs,
        poll
    ];
};

/// @returns an array of objects describing web3.shh.watch api methods
var shh = function () {
    var newFilter = new Method({
        name: 'newFilter',
        call: 'shh_newFilter',
        params: 1
    });

    var uninstallFilter = new Method({
        name: 'uninstallFilter',
        call: 'shh_uninstallFilter',
        params: 1
    });

    var getLogs = new Method({
        name: 'getLogs',
        call: 'shh_getMessages',
        params: 1
    });

    var poll = new Method({
        name: 'poll',
        call: 'shh_getFilterChanges',
        params: 1
    });

    return [
        newFilter,
        uninstallFilter,
        getLogs,
        poll
    ];
};

module.exports = {
    eth: eth,
    shh: shh
};


},{"./method":21}],28:[function(require,module,exports){

},{}],"bignumber.js":[function(require,module,exports){
'use strict';

module.exports = BigNumber; // jshint ignore:line


},{}],"web3":[function(require,module,exports){
var web3 = require('./lib/web3');
web3.providers.HttpProvider = require('./lib/web3/httpprovider');
web3.providers.QtSyncProvider = require('./lib/web3/qtsync');
web3.eth.contract = require('./lib/web3/contract');
web3.abi = require('./lib/solidity/abi');

// dont override global variable
if (typeof window !== 'undefined' && typeof window.web3 === 'undefined') {
    window.web3 = web3;
}

module.exports = web3;


},{"./lib/solidity/abi":1,"./lib/web3":10,"./lib/web3/contract":11,"./lib/web3/httpprovider":19,"./lib/web3/qtsync":24}]},{},["web3"])


//# sourceMappingURL=web3-light.js.map