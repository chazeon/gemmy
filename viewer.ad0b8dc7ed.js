/* generated from web/ by npm run build; do not edit */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/fit-curve/lib/fit-curve.js
var require_fit_curve = __commonJS({
  "node_modules/fit-curve/lib/fit-curve.js"(exports, module) {
    (function(global, factory) {
      if (typeof define === "function" && define.amd) {
        define(["module"], factory);
      } else if (typeof exports !== "undefined") {
        factory(module);
      } else {
        var mod = {
          exports: {}
        };
        factory(mod);
        global.fitCurve = mod.exports;
      }
    })(exports, function(module2) {
      "use strict";
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError("Cannot call a class as a function");
        }
      }
      function fitCurve2(points, maxError, progressCallback) {
        if (!Array.isArray(points)) {
          throw new TypeError("First argument should be an array");
        }
        points.forEach(function(point) {
          if (!Array.isArray(point) || point.some(function(item) {
            return typeof item !== "number";
          }) || point.length !== points[0].length) {
            throw Error("Each point should be an array of numbers. Each point should have the same amount of numbers.");
          }
        });
        points = points.filter(function(point, i2) {
          return i2 === 0 || !point.every(function(val, j2) {
            return val === points[i2 - 1][j2];
          });
        });
        if (points.length < 2) {
          return [];
        }
        var len = points.length;
        var leftTangent = createTangent(points[1], points[0]);
        var rightTangent = createTangent(points[len - 2], points[len - 1]);
        return fitCubic(points, leftTangent, rightTangent, maxError, progressCallback);
      }
      function fitCubic(points, leftTangent, rightTangent, error, progressCallback) {
        var MaxIterations = 20;
        var bezCurve, u2, uPrime, maxError, prevErr, splitPoint, prevSplit, centerVector, toCenterTangent, fromCenterTangent, beziers, dist2, i2;
        if (points.length === 2) {
          dist2 = maths.vectorLen(maths.subtract(points[0], points[1])) / 3;
          bezCurve = [points[0], maths.addArrays(points[0], maths.mulItems(leftTangent, dist2)), maths.addArrays(points[1], maths.mulItems(rightTangent, dist2)), points[1]];
          return [bezCurve];
        }
        u2 = chordLengthParameterize(points);
        var _generateAndReport = generateAndReport(points, u2, u2, leftTangent, rightTangent, progressCallback);
        bezCurve = _generateAndReport[0];
        maxError = _generateAndReport[1];
        splitPoint = _generateAndReport[2];
        if (maxError === 0 || maxError < error) {
          return [bezCurve];
        }
        if (maxError < error * error) {
          uPrime = u2;
          prevErr = maxError;
          prevSplit = splitPoint;
          for (i2 = 0; i2 < MaxIterations; i2++) {
            uPrime = reparameterize(bezCurve, points, uPrime);
            var _generateAndReport2 = generateAndReport(points, u2, uPrime, leftTangent, rightTangent, progressCallback);
            bezCurve = _generateAndReport2[0];
            maxError = _generateAndReport2[1];
            splitPoint = _generateAndReport2[2];
            if (maxError < error) {
              return [bezCurve];
            } else if (splitPoint === prevSplit) {
              var errChange = maxError / prevErr;
              if (errChange > 0.9999 && errChange < 1.0001) {
                break;
              }
            }
            prevErr = maxError;
            prevSplit = splitPoint;
          }
        }
        beziers = [];
        centerVector = maths.subtract(points[splitPoint - 1], points[splitPoint + 1]);
        if (centerVector.every(function(val) {
          return val === 0;
        })) {
          centerVector = maths.subtract(points[splitPoint - 1], points[splitPoint]);
          var _ref = [-centerVector[1], centerVector[0]];
          centerVector[0] = _ref[0];
          centerVector[1] = _ref[1];
        }
        toCenterTangent = maths.normalize(centerVector);
        fromCenterTangent = maths.mulItems(toCenterTangent, -1);
        beziers = beziers.concat(fitCubic(points.slice(0, splitPoint + 1), leftTangent, toCenterTangent, error, progressCallback));
        beziers = beziers.concat(fitCubic(points.slice(splitPoint), fromCenterTangent, rightTangent, error, progressCallback));
        return beziers;
      }
      ;
      function generateAndReport(points, paramsOrig, paramsPrime, leftTangent, rightTangent, progressCallback) {
        var bezCurve, maxError, splitPoint;
        bezCurve = generateBezier(points, paramsPrime, leftTangent, rightTangent, progressCallback);
        var _computeMaxError = computeMaxError(points, bezCurve, paramsOrig);
        maxError = _computeMaxError[0];
        splitPoint = _computeMaxError[1];
        if (progressCallback) {
          progressCallback({
            bez: bezCurve,
            points,
            params: paramsOrig,
            maxErr: maxError,
            maxPoint: splitPoint
          });
        }
        return [bezCurve, maxError, splitPoint];
      }
      function generateBezier(points, parameters, leftTangent, rightTangent) {
        var bezCurve, A, a2, C, X, det_C0_C1, det_C0_X, det_X_C1, alpha_l, alpha_r, epsilon, segLength, i2, len, tmp, u2, ux, firstPoint = points[0], lastPoint = points[points.length - 1];
        bezCurve = [firstPoint, null, null, lastPoint];
        A = maths.zeros_Xx2x2(parameters.length);
        for (i2 = 0, len = parameters.length; i2 < len; i2++) {
          u2 = parameters[i2];
          ux = 1 - u2;
          a2 = A[i2];
          a2[0] = maths.mulItems(leftTangent, 3 * u2 * (ux * ux));
          a2[1] = maths.mulItems(rightTangent, 3 * ux * (u2 * u2));
        }
        C = [[0, 0], [0, 0]];
        X = [0, 0];
        for (i2 = 0, len = points.length; i2 < len; i2++) {
          u2 = parameters[i2];
          a2 = A[i2];
          C[0][0] += maths.dot(a2[0], a2[0]);
          C[0][1] += maths.dot(a2[0], a2[1]);
          C[1][0] += maths.dot(a2[0], a2[1]);
          C[1][1] += maths.dot(a2[1], a2[1]);
          tmp = maths.subtract(points[i2], bezier.q([firstPoint, firstPoint, lastPoint, lastPoint], u2));
          X[0] += maths.dot(a2[0], tmp);
          X[1] += maths.dot(a2[1], tmp);
        }
        det_C0_C1 = C[0][0] * C[1][1] - C[1][0] * C[0][1];
        det_C0_X = C[0][0] * X[1] - C[1][0] * X[0];
        det_X_C1 = X[0] * C[1][1] - X[1] * C[0][1];
        alpha_l = det_C0_C1 === 0 ? 0 : det_X_C1 / det_C0_C1;
        alpha_r = det_C0_C1 === 0 ? 0 : det_C0_X / det_C0_C1;
        segLength = maths.vectorLen(maths.subtract(firstPoint, lastPoint));
        epsilon = 1e-6 * segLength;
        if (alpha_l < epsilon || alpha_r < epsilon) {
          bezCurve[1] = maths.addArrays(firstPoint, maths.mulItems(leftTangent, segLength / 3));
          bezCurve[2] = maths.addArrays(lastPoint, maths.mulItems(rightTangent, segLength / 3));
        } else {
          bezCurve[1] = maths.addArrays(firstPoint, maths.mulItems(leftTangent, alpha_l));
          bezCurve[2] = maths.addArrays(lastPoint, maths.mulItems(rightTangent, alpha_r));
        }
        return bezCurve;
      }
      ;
      function reparameterize(bezier2, points, parameters) {
        return parameters.map(function(p2, i2) {
          return newtonRaphsonRootFind(bezier2, points[i2], p2);
        });
      }
      ;
      function newtonRaphsonRootFind(bez, point, u2) {
        var d2 = maths.subtract(bezier.q(bez, u2), point), qprime = bezier.qprime(bez, u2), numerator = maths.mulMatrix(d2, qprime), denominator = maths.sum(maths.squareItems(qprime)) + 2 * maths.mulMatrix(d2, bezier.qprimeprime(bez, u2));
        if (denominator === 0) {
          return u2;
        } else {
          return u2 - numerator / denominator;
        }
      }
      ;
      function chordLengthParameterize(points) {
        var u2 = [], currU, prevU, prevP;
        points.forEach(function(p2, i2) {
          currU = i2 ? prevU + maths.vectorLen(maths.subtract(p2, prevP)) : 0;
          u2.push(currU);
          prevU = currU;
          prevP = p2;
        });
        u2 = u2.map(function(x2) {
          return x2 / prevU;
        });
        return u2;
      }
      ;
      function computeMaxError(points, bez, parameters) {
        var dist2, maxDist, splitPoint, v2, i2, count2, point, t2;
        maxDist = 0;
        splitPoint = Math.floor(points.length / 2);
        var t_distMap = mapTtoRelativeDistances(bez, 10);
        for (i2 = 0, count2 = points.length; i2 < count2; i2++) {
          point = points[i2];
          t2 = find_t(bez, parameters[i2], t_distMap, 10);
          v2 = maths.subtract(bezier.q(bez, t2), point);
          dist2 = v2[0] * v2[0] + v2[1] * v2[1];
          if (dist2 > maxDist) {
            maxDist = dist2;
            splitPoint = i2;
          }
        }
        return [maxDist, splitPoint];
      }
      ;
      var mapTtoRelativeDistances = function mapTtoRelativeDistances2(bez, B_parts) {
        var B_t_curr;
        var B_t_dist = [0];
        var B_t_prev = bez[0];
        var sumLen = 0;
        for (var i2 = 1; i2 <= B_parts; i2++) {
          B_t_curr = bezier.q(bez, i2 / B_parts);
          sumLen += maths.vectorLen(maths.subtract(B_t_curr, B_t_prev));
          B_t_dist.push(sumLen);
          B_t_prev = B_t_curr;
        }
        B_t_dist = B_t_dist.map(function(x2) {
          return x2 / sumLen;
        });
        return B_t_dist;
      };
      function find_t(bez, param, t_distMap, B_parts) {
        if (param < 0) {
          return 0;
        }
        if (param > 1) {
          return 1;
        }
        var lenMax, lenMin, tMax, tMin, t2;
        for (var i2 = 1; i2 <= B_parts; i2++) {
          if (param <= t_distMap[i2]) {
            tMin = (i2 - 1) / B_parts;
            tMax = i2 / B_parts;
            lenMin = t_distMap[i2 - 1];
            lenMax = t_distMap[i2];
            t2 = (param - lenMin) / (lenMax - lenMin) * (tMax - tMin) + tMin;
            break;
          }
        }
        return t2;
      }
      function createTangent(pointA, pointB) {
        return maths.normalize(maths.subtract(pointA, pointB));
      }
      var maths = function() {
        function maths2() {
          _classCallCheck(this, maths2);
        }
        maths2.zeros_Xx2x2 = function zeros_Xx2x2(x2) {
          var zs = [];
          while (x2--) {
            zs.push([0, 0]);
          }
          return zs;
        };
        maths2.mulItems = function mulItems(items, multiplier) {
          return items.map(function(x2) {
            return x2 * multiplier;
          });
        };
        maths2.mulMatrix = function mulMatrix(m1, m2) {
          return m1.reduce(function(sum, x1, i2) {
            return sum + x1 * m2[i2];
          }, 0);
        };
        maths2.subtract = function subtract(arr1, arr2) {
          return arr1.map(function(x1, i2) {
            return x1 - arr2[i2];
          });
        };
        maths2.addArrays = function addArrays(arr1, arr2) {
          return arr1.map(function(x1, i2) {
            return x1 + arr2[i2];
          });
        };
        maths2.addItems = function addItems(items, addition) {
          return items.map(function(x2) {
            return x2 + addition;
          });
        };
        maths2.sum = function sum(items) {
          return items.reduce(function(sum2, x2) {
            return sum2 + x2;
          });
        };
        maths2.dot = function dot(m1, m2) {
          return maths2.mulMatrix(m1, m2);
        };
        maths2.vectorLen = function vectorLen(v2) {
          return Math.hypot.apply(Math, v2);
        };
        maths2.divItems = function divItems(items, divisor) {
          return items.map(function(x2) {
            return x2 / divisor;
          });
        };
        maths2.squareItems = function squareItems(items) {
          return items.map(function(x2) {
            return x2 * x2;
          });
        };
        maths2.normalize = function normalize(v2) {
          return this.divItems(v2, this.vectorLen(v2));
        };
        return maths2;
      }();
      var bezier = function() {
        function bezier2() {
          _classCallCheck(this, bezier2);
        }
        bezier2.q = function q(ctrlPoly, t2) {
          var tx = 1 - t2;
          var pA = maths.mulItems(ctrlPoly[0], tx * tx * tx), pB = maths.mulItems(ctrlPoly[1], 3 * tx * tx * t2), pC = maths.mulItems(ctrlPoly[2], 3 * tx * t2 * t2), pD = maths.mulItems(ctrlPoly[3], t2 * t2 * t2);
          return maths.addArrays(maths.addArrays(pA, pB), maths.addArrays(pC, pD));
        };
        bezier2.qprime = function qprime(ctrlPoly, t2) {
          var tx = 1 - t2;
          var pA = maths.mulItems(maths.subtract(ctrlPoly[1], ctrlPoly[0]), 3 * tx * tx), pB = maths.mulItems(maths.subtract(ctrlPoly[2], ctrlPoly[1]), 6 * tx * t2), pC = maths.mulItems(maths.subtract(ctrlPoly[3], ctrlPoly[2]), 3 * t2 * t2);
          return maths.addArrays(maths.addArrays(pA, pB), pC);
        };
        bezier2.qprimeprime = function qprimeprime(ctrlPoly, t2) {
          return maths.addArrays(maths.mulItems(maths.addArrays(maths.subtract(ctrlPoly[2], maths.mulItems(ctrlPoly[1], 2)), ctrlPoly[0]), 6 * (1 - t2)), maths.mulItems(maths.addArrays(maths.subtract(ctrlPoly[3], maths.mulItems(ctrlPoly[2], 2)), ctrlPoly[1]), 6 * t2));
        };
        return bezier2;
      }();
      module2.exports = fitCurve2;
      module2.exports.fitCubic = fitCubic;
      module2.exports.createTangent = createTangent;
    });
  }
});

// src/render/draw.ts
import * as THREE3 from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";

// src/config.ts
var LOOK = {
  azimuth: 35,
  elevation: 28,
  dark: 0.72,
  // brightness of the shaded band
  threshold: 0.25,
  // N.L above which a surface is lit
  // The key light, screen-relative: right, up, towards the viewer.
  key: [-0.55, 0.6, 0.6],
  outline: [0.02, 0.02, 0.05],
  axisColors: ["#cc3833", "#389e47", "#3861cc"]
};
var DASH = { length: 6, gap: 4, min: 0.1 };
var DOT = { radius: 1.6, spacing: 8, spacingMin: 0.12 };
var ARROW = { radius: 0.05, color: [0.04, 0.04, 0.05], headRadiusRatio: 2.8, headLengthRatio: 0.6 };
var STEP = { rotate: 15, pan: 0.05, zoom: 1.1 };
var RATE = { rotate: 90, pan: 0.4, zoom: 1.8 };
var EPS = 1e-9;
var POINTER_SLOP_PX = 5;
var GEMMY = {"sceneSchemaVersion": 2, "distanceFactor": 2.2, "distanceMin": 4.0, "orthoFactor": 1.1, "orthoMin": 3.0, "sensorWidth": 36.0, "lenses": [24.0, 35.0, 50.0, 70.0, 85.0], "defaultLens": 70.0, "triad": {"size": 0.11, "margin": 0.14, "arrowRadius": 0.037, "labelPad": 0.15, "labelSize": 0.5, "labelReach": 2.2, "headRadiusRatio": 2.2, "headLengthRatio": 0.22, "dotRadius": 0.0875, "depthFadeMax": 0.35}};
var AXIS_FONT = { family: "Gemmy Axis Labels", faces: {"700": "AAEAAAAPAIAAAwBwQkFTRWUeXb0AAAx0AAAARkdERUYAEQAEAAAMvAAAABZHUE9TRHZMdQAADNQAAAAgR1NVQpMVghYAAAz0AAAANk9TLzJb6lkEAAABeAAAAGBjbWFwAAwAtgAAAegAAAA0Z2FzcAAAABAAAAxsAAAACGdseWbcNofMAAACKAAAAThoZWFkLBhHFgAAAPwAAAA2aGhlYQovCJEAAAE0AAAAJGhtdHgIowBnAAAB2AAAABBsb2NhANIAbgAAAhwAAAAKbWF4cAAeAQgAAAFYAAAAIG5hbWUzEVhyAAADYAAACOlwb3N0/8YAMgAADEwAAAAgAAEAAAADDU9W1SQAXw889QAHA+gAAAAA4Es5kwAAAADnK7yy/WP+xwgeA9sAAwADAAIAAAAAAAAAAQAAA+j+ugAACED9Y/3bCB4D6ADC/9AAAAAAAAAAAAAAAAQAAQAAAAQAkAAMAHQACQABAAAAAAAAAAAAAAAAAAQAAwADAhkCvAAFAAACigJY//EASwKKAlgARAFeADIBKQAAAgsIAwMEAwkCBAAAAAEAAAAAAAAAAAAAAABBREJPACEAYQBjA+j+ugAAA+gBRgAAAAEAAAAAAfAClAAAACAABQKXAB0CKAAfAikADgG7AB0AAAACAAAAAwAAABQAAwABAAAAFAAEACAAAAAEAAQAAQAAAGP//wAAAGH///+gAAEAAAAAAAAAAAA2AG4AnAAAAAIAH//0AhkB/AAUACIAABciJjU0PgIzMhYXMzczAyM3IwYGNzI2NzcmJiMiBgYVFBarQUssS18zIjwOAhZtY28CAyJSFRk5GCMMJREiPSYfDF5YR3tcNCMeNf4QQSMqcB8qsBkWN148LSoAAAIADv/0AggCvQAVACMAAAUiJicjByMTMwcHMzY2MzIWFRQOAicyNjY1NCYjIgYHBxYWAQAiOQ4CFnGNiSEZAiFKJUJKLEpfPSM8JiAaFzkWJgsjDCMeNQK9n10bIF5YR3tcNHA3XjwtKhsjuxkWAAABAB3/9AHGAfwAHQAAFyImJjU0PgIzMhYXByYmIyIGBhUUFjMyNjcXBgbfN1gzLU9qPDFEEkoOHxcmQicsKBknDzkeUAwwXEBBclcyJhdODg84XDctNBQMTRwlAAAAFwEaAAEAAAAAAAEAEQAAAAEAAAAAAAIACwARAAEAAAAAAAMAQgAcAAEAAAAAAAQAHQBeAAEAAAAAAAYAGgB7AAEAAAAAABAAEQAAAAEAAAAAABEACwARAAMAAQQJAAAAjACVAAMAAQQJAAEAIgEhAAMAAQQJAAIAFgFDAAMAAQQJAAMAhAFZAAMAAQQJAAQAOgHdAAMAAQQJAAUAWAIXAAMAAQQJAAYANAJvAAMAAQQJAAcAlgKjAAMAAQQJAAgACgM5AAMAAQQJAAkAGANDAAMAAQQJAAoA7gNbAAMAAQQJAAsAMgRJAAMAAQQJAA0DIAR7AAMAAQQJAA4ANAebAAMAAQQJABAAIgEhAAMAAQQJABEAFgFDR2VtbXkgQXhpcyBMYWJlbHNCb2xkIEl0YWxpY0dlbW15QXhpc0xhYmVscy1Cb2xkSXRhbGljO3N1YnNldCBvZiBTb3VyY2UgU2FucyAzLjA1MiBCb2xkIEl0YWxpY0dlbW15IEF4aXMgTGFiZWxzIEJvbGQgSXRhbGljR2VtbXlBeGlzTGFiZWxzLUJvbGRJdGFsaWMAqQAgADIAMAAyADMAIABBAGQAbwBiAGUAIAAoAGgAdAB0AHAAOgAvAC8AdwB3AHcALgBhAGQAbwBiAGUALgBjAG8AbQAvACkALAAgAHcAaQB0AGgAIABSAGUAcwBlAHIAdgBlAGQAIABGAG8AbgB0ACAATgBhAG0AZQAgIBgAUwBvAHUAcgBjAGUgGQBHAGUAbQBtAHkAIABBAHgAaQBzACAATABhAGIAZQBsAHMAQgBvAGwAZAAgAEkAdABhAGwAaQBjAEcAZQBtAG0AeQBBAHgAaQBzAEwAYQBiAGUAbABzAC0AQgBvAGwAZABJAHQAYQBsAGkAYwA7AHMAdQBiAHMAZQB0ACAAbwBmACAAUwBvAHUAcgBjAGUAIABTAGEAbgBzACAAMwAuADAANQAyACAAQgBvAGwAZAAgAEkAdABhAGwAaQBjAEcAZQBtAG0AeQAgAEEAeABpAHMAIABMAGEAYgBlAGwAcwAgAEIAbwBsAGQAIABJAHQAYQBsAGkAYwBWAGUAcgBzAGkAbwBuACAAMwAuADAANQAyADsAaABvAHQAYwBvAG4AdgAgADEALgAxAC4AMAA7AG0AYQBrAGUAbwB0AGYAZQB4AGUAIAAyAC4ANgAuADAARwBlAG0AbQB5AEEAeABpAHMATABhAGIAZQBsAHMALQBCAG8AbABkAEkAdABhAGwAaQBjAFMAbwB1AHIAYwBlACAAaQBzACAAYQAgAHQAcgBhAGQAZQBtAGEAcgBrACAAbwBmACAAQQBkAG8AYgBlACAAaQBuACAAdABoAGUAIABVAG4AaQB0AGUAZAAgAFMAdABhAHQAZQBzACAAYQBuAGQALwBvAHIAIABvAHQAaABlAHIAIABjAG8AdQBuAHQAcgBpAGUAcwAuAEEAZABvAGIAZQBQAGEAdQBsACAARAAuACAASAB1AG4AdABTAHUAYgBzAGUAdAAgAG8AZgAgAFMAbwB1AHIAYwBlACAAUwBhAG4AcwAgADMAIAAoAHYAZQByAHMAaQBvAG4AIAAzAC4AMAA1ADIAKQAgAEIAbwBsAGQAIABJAHQAYQBsAGkAYwAsACAAcgBlAG4AYQBtAGUAZAAgAGEAcwAgAE8ARgBMACAAMQAuADEAIABhAHMAawBzACAAZgBvAHIAIABhACAAbQBvAGQAaQBmAGkAZQBkACAAdgBlAHIAcwBpAG8AbgA7ACAAZwBsAHkAcABoAHMAIABhACAAYgAgAGMAIABvAG4AbAB5AC4AaAB0AHQAcAA6AC8ALwB3AHcAdwAuAGEAZABvAGIAZQAuAGMAbwBtAC8AdAB5AHAAZQBUAGgAaQBzACAARgBvAG4AdAAgAFMAbwBmAHQAdwBhAHIAZQAgAGkAcwAgAGwAaQBjAGUAbgBzAGUAZAAgAHUAbgBkAGUAcgAgAHQAaABlACAAUwBJAEwAIABPAHAAZQBuACAARgBvAG4AdAAgAEwAaQBjAGUAbgBzAGUALAAgAFYAZQByAHMAaQBvAG4AIAAxAC4AMQAuACAAVABoAGkAcwAgAGwAaQBjAGUAbgBzAGUAIABpAHMAIABhAHYAYQBpAGwAYQBiAGwAZQAgAHcAaQB0AGgAIABhACAARgBBAFEAIABhAHQAOgAgAGgAdAB0AHAAOgAvAC8AcwBjAHIAaQBwAHQAcwAuAHMAaQBsAC4AbwByAGcALwBPAEYATAAuACAAVABoAGkAcwAgAEYAbwBuAHQAIABTAG8AZgB0AHcAYQByAGUAIABpAHMAIABkAGkAcwB0AHIAaQBiAHUAdABlAGQAIABvAG4AIABhAG4AICAYAEEAUwAgAEkAUyAZACAAQgBBAFMASQBTACwAIABXAEkAVABIAE8AVQBUACAAVwBBAFIAUgBBAE4AVABJAEUAUwAgAE8AUgAgAEMATwBOAEQASQBUAEkATwBOAFMAIABPAEYAIABBAE4AWQAgAEsASQBOAEQALAAgAGUAaQB0AGgAZQByACAAZQB4AHAAcgBlAHMAcwAgAG8AcgAgAGkAbQBwAGwAaQBlAGQALgAgAFMAZQBlACAAdABoAGUAIABTAEkATAAgAE8AcABlAG4AIABGAG8AbgB0ACAATABpAGMAZQBuAHMAZQAgAGYAbwByACAAdABoAGUAIABzAHAAZQBjAGkAZgBpAGMAIABsAGEAbgBnAHUAYQBnAGUALAAgAHAAZQByAG0AaQBzAHMAaQBvAG4AcwAgAGEAbgBkACAAbABpAG0AaQB0AGEAdABpAG8AbgBzACAAZwBvAHYAZQByAG4AaQBuAGcAIAB5AG8AdQByACAAdQBzAGUAIABvAGYAIAB0AGgAaQBzACAARgBvAG4AdAAgAFMAbwBmAHQAdwBhAHIAZQAuAGgAdAB0AHAAOgAvAC8AcwBjAHIAaQBwAHQAcwAuAHMAaQBsAC4AbwByAGcALwBPAEYATAAAAAADAAD/9QAA/84AMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAf//AA8AAQAAAAgAAAAEAA4AAmlkZW9yb21uAARERkxUABpjeXJsABpncmVrABpsYXRuABoABgAAAAAAAQACAAgADAAB/1YAAQAAAAAAAQAAAAwAAAAAAAAAAgABAAEAAwABAAAAAQAAAAoAHAAeAAFERkxUAAgABAAAAAD//wAAAAAAAAABAAAACgAyADQABERGTFQAGmN5cmwAJGdyZWsAJGxhdG4AJAAEAAAAAP//AAAAAAAAAAAAAAAA", "400": "AAEAAAAPAIAAAwBwQkFTRWUeXb0AAAwoAAAARkdERUYAEQAEAAAMcAAAABZHUE9TRHZMdQAADIgAAAAgR1NVQpMVghYAAAyoAAAANk9TLzJauFW5AAABeAAAAGBjbWFwAAwAtgAAAegAAAA0Z2FzcAAAABAAAAwgAAAACGdseWZUVn/OAAACKAAAATpoZWFkLDdHFwAAAPwAAAA2aGhlYQpPCKYAAAE0AAAAJGhtdHgIWACPAAAB2AAAABBsb2NhANQAbwAAAhwAAAAKbWF4cAAeARQAAAFYAAAAIG5hbWXw1vKwAAADZAAACJpwb3N0/8YAMgAADAAAAAAgAAEAAAADDU/tggeRXw889QAHA+gAAAAA4Es5oAAAAADnK7yy/YT+2QgdA70AAgADAAIAAAAAAAAAAQAAA+j+ugAACED9hP3vCB0D6ADC/9EAAAAAAAAAAAAAAAQAAQAAAAQAjAAMAIQACQABAAAAAAAAAAAAAAAAAAQAAwADAfgBkAAFAAACigJY//EASwKKAlgARAFeADIBIwAAAgsFAwMEAwkCBAAAAAEAAAAAAAAAAAAAAABBREJPAAEAYQBjA+j+ugAAA+gBRgAAAAEAAAAAAeYClAAAACAABQJ0ACQCGQAnAhgAHwGzACUAAAACAAAAAwAAABQAAwABAAAAFAAEACAAAAAEAAQAAQAAAGP//wAAAGH///+gAAEAAAAAAAAAAAA3AG8AnQAAAAIAJ//0AfgB8gAUACMAABciJjU0PgIzMhYXMzczAyM3IwYGJzI2NzcmJiMiDgIVFBazQEwsSl4zJz0RBBM+YT8IBCNYEiZPJCwVMhwkQzUfMQxbVUZ5XDMoIT3+GkglL0AuL9kmIipJXTI/PQAAAgAf//QB8ALIABUAJAAAFyImJyMHIxMzBwczNjYzMhYVFA4CJzI+AjU0JiMiBgcHFhbqJz0RAxQ/jk0nFgIkVC1ATCxKXjUkQzUeMCkiUSMuFDMMKCE9Asi+YB0rWlZGeVwzQCpJXTM+PSol5yYiAAEAJf/0AbIB8gAdAAAXIiY1ND4CMzIWFwcmJiMiDgIVFBYzMjY3FwYG2E9kLE1hNSw/EysRKR4kQzYfOjkfOhQhG04MZl1Ec1UvIhkrFBMnRVkyQkYZECwYJQAAAAAAABcBGgABAAAAAAABABEAAAABAAAAAAACAAYAEQABAAAAAAADADkAFwABAAAAAAAEABgAUAABAAAAAAAGABYAaAABAAAAAAAQABEAAAABAAAAAAARAAYAEQADAAEECQAAAIwAfgADAAEECQABACIBCgADAAEECQACAAwBLAADAAEECQADAHIBOAADAAEECQAEADABqgADAAEECQAFAFgB2gADAAEECQAGACwCMgADAAEECQAHAJYCXgADAAEECQAIAAoC9AADAAEECQAJABgC/gADAAEECQAKAOQDFgADAAEECQALADID+gADAAEECQANAyAELAADAAEECQAOADQHTAADAAEECQAQACIBCgADAAEECQARAAwBLEdlbW15IEF4aXMgTGFiZWxzSXRhbGljR2VtbXlBeGlzTGFiZWxzLUl0YWxpYztzdWJzZXQgb2YgU291cmNlIFNhbnMgMy4wNTIgSXRhbGljR2VtbXkgQXhpcyBMYWJlbHMgSXRhbGljR2VtbXlBeGlzTGFiZWxzLUl0YWxpYwCpACAAMgAwADIAMwAgAEEAZABvAGIAZQAgACgAaAB0AHQAcAA6AC8ALwB3AHcAdwAuAGEAZABvAGIAZQAuAGMAbwBtAC8AKQAsACAAdwBpAHQAaAAgAFIAZQBzAGUAcgB2AGUAZAAgAEYAbwBuAHQAIABOAGEAbQBlACAgGABTAG8AdQByAGMAZSAZAEcAZQBtAG0AeQAgAEEAeABpAHMAIABMAGEAYgBlAGwAcwBJAHQAYQBsAGkAYwBHAGUAbQBtAHkAQQB4AGkAcwBMAGEAYgBlAGwAcwAtAEkAdABhAGwAaQBjADsAcwB1AGIAcwBlAHQAIABvAGYAIABTAG8AdQByAGMAZQAgAFMAYQBuAHMAIAAzAC4AMAA1ADIAIABJAHQAYQBsAGkAYwBHAGUAbQBtAHkAIABBAHgAaQBzACAATABhAGIAZQBsAHMAIABJAHQAYQBsAGkAYwBWAGUAcgBzAGkAbwBuACAAMwAuADAANQAyADsAaABvAHQAYwBvAG4AdgAgADEALgAxAC4AMAA7AG0AYQBrAGUAbwB0AGYAZQB4AGUAIAAyAC4ANgAuADAARwBlAG0AbQB5AEEAeABpAHMATABhAGIAZQBsAHMALQBJAHQAYQBsAGkAYwBTAG8AdQByAGMAZQAgAGkAcwAgAGEAIAB0AHIAYQBkAGUAbQBhAHIAawAgAG8AZgAgAEEAZABvAGIAZQAgAGkAbgAgAHQAaABlACAAVQBuAGkAdABlAGQAIABTAHQAYQB0AGUAcwAgAGEAbgBkAC8AbwByACAAbwB0AGgAZQByACAAYwBvAHUAbgB0AHIAaQBlAHMALgBBAGQAbwBiAGUAUABhAHUAbAAgAEQALgAgAEgAdQBuAHQAUwB1AGIAcwBlAHQAIABvAGYAIABTAG8AdQByAGMAZQAgAFMAYQBuAHMAIAAzACAAKAB2AGUAcgBzAGkAbwBuACAAMwAuADAANQAyACkAIABJAHQAYQBsAGkAYwAsACAAcgBlAG4AYQBtAGUAZAAgAGEAcwAgAE8ARgBMACAAMQAuADEAIABhAHMAawBzACAAZgBvAHIAIABhACAAbQBvAGQAaQBmAGkAZQBkACAAdgBlAHIAcwBpAG8AbgA7ACAAZwBsAHkAcABoAHMAIABhACAAYgAgAGMAIABvAG4AbAB5AC4AaAB0AHQAcAA6AC8ALwB3AHcAdwAuAGEAZABvAGIAZQAuAGMAbwBtAC8AdAB5AHAAZQBUAGgAaQBzACAARgBvAG4AdAAgAFMAbwBmAHQAdwBhAHIAZQAgAGkAcwAgAGwAaQBjAGUAbgBzAGUAZAAgAHUAbgBkAGUAcgAgAHQAaABlACAAUwBJAEwAIABPAHAAZQBuACAARgBvAG4AdAAgAEwAaQBjAGUAbgBzAGUALAAgAFYAZQByAHMAaQBvAG4AIAAxAC4AMQAuACAAVABoAGkAcwAgAGwAaQBjAGUAbgBzAGUAIABpAHMAIABhAHYAYQBpAGwAYQBiAGwAZQAgAHcAaQB0AGgAIABhACAARgBBAFEAIABhAHQAOgAgAGgAdAB0AHAAOgAvAC8AcwBjAHIAaQBwAHQAcwAuAHMAaQBsAC4AbwByAGcALwBPAEYATAAuACAAVABoAGkAcwAgAEYAbwBuAHQAIABTAG8AZgB0AHcAYQByAGUAIABpAHMAIABkAGkAcwB0AHIAaQBiAHUAdABlAGQAIABvAG4AIABhAG4AICAYAEEAUwAgAEkAUyAZACAAQgBBAFMASQBTACwAIABXAEkAVABIAE8AVQBUACAAVwBBAFIAUgBBAE4AVABJAEUAUwAgAE8AUgAgAEMATwBOAEQASQBUAEkATwBOAFMAIABPAEYAIABBAE4AWQAgAEsASQBOAEQALAAgAGUAaQB0AGgAZQByACAAZQB4AHAAcgBlAHMAcwAgAG8AcgAgAGkAbQBwAGwAaQBlAGQALgAgAFMAZQBlACAAdABoAGUAIABTAEkATAAgAE8AcABlAG4AIABGAG8AbgB0ACAATABpAGMAZQBuAHMAZQAgAGYAbwByACAAdABoAGUAIABzAHAAZQBjAGkAZgBpAGMAIABsAGEAbgBnAHUAYQBnAGUALAAgAHAAZQByAG0AaQBzAHMAaQBvAG4AcwAgAGEAbgBkACAAbABpAG0AaQB0AGEAdABpAG8AbgBzACAAZwBvAHYAZQByAG4AaQBuAGcAIAB5AG8AdQByACAAdQBzAGUAIABvAGYAIAB0AGgAaQBzACAARgBvAG4AdAAgAFMAbwBmAHQAdwBhAHIAZQAuAGgAdAB0AHAAOgAvAC8AcwBjAHIAaQBwAHQAcwAuAHMAaQBsAC4AbwByAGcALwBPAEYATAAAAAMAAP/1AAD/zgAyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAB//8ADwABAAAACAAAAAQADgACaWRlb3JvbW4ABERGTFQAGmN5cmwAGmdyZWsAGmxhdG4AGgAGAAAAAAABAAIACAAMAAH/VgABAAAAAAABAAAADAAAAAAAAAACAAEAAQADAAEAAAABAAAACgAcAB4AAURGTFQACAAEAAAAAP//AAAAAAAAAAEAAAAKADIANAAEREZMVAAaY3lybAAkZ3JlawAkbGF0bgAkAAQAAAAA//8AAAAAAAAAAAAAAAA="} };
var AXIS_LETTERS = "abc";
var axisFontFace = (weight) => `@font-face { font-family: "${AXIS_FONT.family}"; font-style: italic; font-weight: ${weight}; src: url(data:font/ttf;base64,${AXIS_FONT.faces[weight]}) format("truetype"); }`;

// node_modules/@preact/signals-core/dist/signals-core.module.js
var i = Symbol.for("preact-signals");
function t() {
  if (!(v > 1)) {
    var i2, t2 = false;
    !function() {
      var i3 = c;
      c = void 0;
      while (void 0 !== i3) {
        var t3 = i3.S;
        if (t3.v === i3.v) {
          for (var r3 = t3.t; void 0 !== r3; r3 = r3.x) if (r3.i === i3.i) r3.i = t3.i;
        }
        i3 = i3.o;
      }
    }();
    while (void 0 !== h) {
      var r2 = h;
      h = void 0;
      s++;
      while (void 0 !== r2) {
        var n2 = r2.u;
        r2.u = void 0;
        r2.f &= -3;
        if (!(8 & r2.f) && w(r2)) try {
          r2.c();
        } catch (r3) {
          if (!t2) {
            i2 = r3;
            t2 = true;
          }
        }
        r2 = n2;
      }
    }
    s = 0;
    v--;
    if (t2) throw i2;
  } else v--;
}
function r(i2) {
  if (v > 0) return i2();
  u = ++e;
  v++;
  try {
    return i2();
  } finally {
    t();
  }
}
var n;
var o = void 0;
function f(i2) {
  var t2 = o, r2 = n;
  o = void 0;
  n = void 0;
  try {
    return i2();
  } finally {
    o = t2;
    n = r2;
  }
}
var h = void 0;
var v = 0;
var s = 0;
var e = 0;
var u = 0;
var c = void 0;
var a = 0;
function d(i2) {
  if (void 0 !== o) {
    var t2 = i2.n;
    if (void 0 === t2 || t2.t !== o) {
      t2 = { i: 0, S: i2, p: o.s, n: void 0, t: o, e: void 0, x: void 0, r: t2 };
      if (void 0 !== o.s) o.s.n = t2;
      o.s = t2;
      i2.n = t2;
      if (32 & o.f) i2.S(t2);
      return t2;
    } else if (-1 === t2.i) {
      t2.i = 0;
      if (void 0 !== t2.n) {
        t2.n.p = t2.p;
        if (void 0 !== t2.p) t2.p.n = t2.n;
        t2.p = o.s;
        t2.n = void 0;
        o.s.n = t2;
        o.s = t2;
      }
      return t2;
    }
  }
}
function l(i2, t2) {
  this.v = i2;
  this.i = 0;
  this.n = void 0;
  this.t = void 0;
  this.l = 0;
  this.W = null == t2 ? void 0 : t2.watched;
  this.Z = null == t2 ? void 0 : t2.unwatched;
  this.name = null == t2 ? void 0 : t2.name;
}
l.prototype.brand = i;
l.prototype.h = function() {
  return true;
};
l.prototype.S = function(i2) {
  var t2 = this, r2 = this.t;
  if (r2 !== i2 && void 0 === i2.e) {
    i2.x = r2;
    this.t = i2;
    if (void 0 !== r2) r2.e = i2;
    else f(function() {
      var i3;
      null == (i3 = t2.W) || i3.call(t2);
    });
  }
};
l.prototype.U = function(i2) {
  var t2 = this;
  if (void 0 !== this.t) {
    var r2 = i2.e, n2 = i2.x;
    if (void 0 !== r2) {
      r2.x = n2;
      i2.e = void 0;
    }
    if (void 0 !== n2) {
      n2.e = r2;
      i2.x = void 0;
    }
    if (i2 === this.t) {
      this.t = n2;
      if (void 0 === n2) f(function() {
        var i3;
        null == (i3 = t2.Z) || i3.call(t2);
      });
    }
  }
};
l.prototype.subscribe = function(i2) {
  var t2 = this;
  return x(function() {
    var r2 = t2.value;
    f(function() {
      return i2(r2);
    });
  }, { name: "sub" });
};
l.prototype.valueOf = function() {
  return this.value;
};
l.prototype.toString = function() {
  return this.value + "";
};
l.prototype.toJSON = function() {
  return this.value;
};
l.prototype.peek = function() {
  var i2 = this;
  return f(function() {
    return i2.value;
  });
};
Object.defineProperty(l.prototype, "value", { get: function() {
  var i2 = d(this);
  if (void 0 !== i2) i2.i = this.i;
  return this.v;
}, set: function(i2) {
  if (i2 !== this.v) {
    if (s > 100) throw new Error("Cycle detected");
    !function(i3) {
      if (0 !== v && 0 === s) {
        if (i3.l !== u) {
          i3.l = u;
          c = { S: i3, v: i3.v, i: i3.i, o: c };
        }
      }
    }(this);
    this.v = i2;
    this.i++;
    a++;
    v++;
    try {
      for (var r2 = this.t; void 0 !== r2; r2 = r2.x) r2.t.N();
    } finally {
      t();
    }
  }
} });
function y(i2, t2) {
  return new l(i2, t2);
}
function w(i2) {
  for (var t2 = i2.s; void 0 !== t2; t2 = t2.n) if (t2.S.i !== t2.i || !t2.S.h() || t2.S.i !== t2.i) return true;
  return false;
}
function b(i2) {
  for (var t2 = i2.s; void 0 !== t2; t2 = t2.n) {
    var r2 = t2.S.n;
    if (void 0 !== r2) t2.r = r2;
    t2.S.n = t2;
    t2.i = -1;
    if (void 0 === t2.n) {
      i2.s = t2;
      break;
    }
  }
}
function _(i2) {
  var t2 = i2.s, r2 = void 0;
  while (void 0 !== t2) {
    var n2 = t2.p;
    if (-1 === t2.i) {
      t2.S.U(t2);
      if (void 0 !== n2) n2.n = t2.n;
      if (void 0 !== t2.n) t2.n.p = n2;
    } else r2 = t2;
    t2.S.n = t2.r;
    if (void 0 !== t2.r) t2.r = void 0;
    t2 = n2;
  }
  i2.s = r2;
}
function j(i2, t2) {
  l.call(this, void 0, t2);
  this.x = i2;
  this.s = void 0;
  this.g = a - 1;
  this.f = 4;
}
j.prototype = new l();
j.prototype.h = function() {
  this.f &= -3;
  if (1 & this.f) return false;
  if (32 == (36 & this.f)) return true;
  this.f &= -5;
  if (this.g === a) return true;
  this.g = a;
  this.f |= 1;
  if (this.i > 0 && !w(this)) {
    this.f &= -2;
    return true;
  }
  var i2 = o;
  try {
    b(this);
    o = this;
    var t2 = this.x();
    if (16 & this.f || this.v !== t2 || 0 === this.i) {
      this.v = t2;
      this.f &= -17;
      this.i++;
    }
  } catch (i3) {
    this.v = i3;
    this.f |= 16;
    this.i++;
  }
  o = i2;
  _(this);
  this.f &= -2;
  return true;
};
j.prototype.S = function(i2) {
  if (void 0 === this.t) {
    this.f |= 36;
    for (var t2 = this.s; void 0 !== t2; t2 = t2.n) t2.S.S(t2);
  }
  l.prototype.S.call(this, i2);
};
j.prototype.U = function(i2) {
  if (void 0 !== this.t) {
    l.prototype.U.call(this, i2);
    if (void 0 === this.t) {
      this.f &= -33;
      for (var t2 = this.s; void 0 !== t2; t2 = t2.n) t2.S.U(t2);
    }
  }
};
j.prototype.N = function() {
  if (!(2 & this.f)) {
    this.f |= 6;
    for (var i2 = this.t; void 0 !== i2; i2 = i2.x) i2.t.N();
  }
};
Object.defineProperty(j.prototype, "value", { get: function() {
  if (1 & this.f) throw new Error("Cycle detected");
  var i2 = d(this);
  this.h();
  if (void 0 !== i2) i2.i = this.i;
  if (16 & this.f) throw this.v;
  return this.v;
} });
function p(i2) {
  var r2 = i2.j;
  i2.j = void 0;
  if ("function" == typeof r2) {
    v++;
    var n2 = o;
    o = void 0;
    try {
      r2();
    } catch (t2) {
      i2.f &= -2;
      i2.f |= 8;
      g(i2);
      throw t2;
    } finally {
      o = n2;
      t();
    }
  }
}
function g(i2) {
  for (var t2 = i2.s; void 0 !== t2; t2 = t2.n) t2.S.U(t2);
  i2.x = void 0;
  i2.s = void 0;
  p(i2);
}
function S(i2) {
  if (o !== this) throw new Error("Out-of-order effect");
  _(this);
  o = i2;
  this.f &= -2;
  try {
    if (8 & this.f) g(this);
  } finally {
    t();
  }
}
function m(i2, t2) {
  this.x = i2;
  this.j = void 0;
  this.s = void 0;
  this.u = void 0;
  this.f = 32;
  this.name = null == t2 ? void 0 : t2.name;
  if (n) n.push(this);
}
m.prototype.c = function() {
  var i2 = this.S();
  try {
    if (8 & this.f) return;
    if (void 0 === this.x) return;
    var t2 = this.x();
    if ("function" == typeof t2) this.j = t2;
  } finally {
    i2();
  }
};
m.prototype.S = function() {
  if (1 & this.f) throw new Error("Cycle detected");
  this.f |= 1;
  this.f &= -9;
  p(this);
  b(this);
  v++;
  var i2 = o;
  o = this;
  return S.bind(this, i2);
};
m.prototype.N = function() {
  if (!(2 & this.f)) {
    this.f |= 2;
    this.u = h;
    h = this;
  }
};
m.prototype.d = function() {
  this.f |= 8;
  if (!(1 & this.f)) g(this);
};
m.prototype.dispose = function() {
  this.d();
};
function x(i2, t2) {
  var r2 = new m(i2, t2);
  try {
    r2.c();
  } catch (i3) {
    r2.d();
    throw i3;
  }
  var n2 = r2.d.bind(r2);
  n2[Symbol.dispose] = n2;
  return n2;
}

// src/state.ts
import * as THREE from "three";
var EMPTY_SCENE = {
  data: void 0,
  // no scene yet: hasScene() is false
  points: /* @__PURE__ */ new Map(),
  polyhedra: [],
  centre: [0, 0, 0],
  extent: 1,
  lattice: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)],
  atomGroup: new THREE.Group(),
  polyGroup: new THREE.Group(),
  box: null,
  polyTargets: []
};
var loaded = y(EMPTY_SCENE);
var hasScene = () => loaded.peek().data !== void 0;
var showAtoms = y(true);
var showBox = y(true);
var outlines = y(true);
var camera = y(new THREE.OrthographicCamera());
var lens = y(GEMMY.defaultLens);
var fitValue = y(1);
var projection = y("ortho");
var dirty = true;
function requestRender() {
  dirty = true;
}
function takeDirty() {
  const was = dirty;
  dirty = false;
  return was;
}

// src/render/instancing.ts
import { MathUtils, Matrix4, Quaternion, Vector3 as Vector32 } from "three";

// src/geom/vector.ts
var lerp = (a2, b2, t2) => a2.map((x2, i2) => x2 + (b2[i2] - x2) * t2);
var span = (a2, b2) => Math.hypot(b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]);
var vdot = (a2, b2) => a2[0] * b2[0] + a2[1] * b2[1] + a2[2] * b2[2];
var vsub = (a2, b2) => [a2[0] - b2[0], a2[1] - b2[1], a2[2] - b2[2]];
var vadd = (a2, b2) => [a2[0] + b2[0], a2[1] + b2[1], a2[2] + b2[2]];
var vscale = (a2, k) => [a2[0] * k, a2[1] * k, a2[2] * k];
var vcross = (a2, b2) => [
  a2[1] * b2[2] - a2[2] * b2[1],
  a2[2] * b2[0] - a2[0] * b2[2],
  a2[0] * b2[1] - a2[1] * b2[0]
];
function vunit(a2) {
  const length2 = Math.hypot(...a2) || 1;
  return a2.map((x2) => x2 / length2);
}

// src/geom/dashes.ts
function dashSegments(a2, b2, dash, gap) {
  const len = span(a2, b2);
  if (len <= EPS) return [];
  const count2 = Math.max(1, Math.round((len + gap) / (dash + gap)));
  const stretch = len / (count2 * dash + (count2 - 1) * gap);
  const dashFraction = dash * stretch / len;
  const periodFraction = (dash + gap) * stretch / len;
  return Array.from({ length: count2 }, (_2, i2) => [
    lerp(a2, b2, i2 * periodFraction),
    lerp(a2, b2, i2 * periodFraction + dashFraction)
  ]);
}
function dotCentres(a2, b2, spacing) {
  const len = span(a2, b2);
  if (len <= EPS) return [];
  const count2 = Math.max(1, Math.round(len / spacing));
  return Array.from({ length: count2 }, (_2, i2) => lerp(a2, b2, (i2 + 0.5) / count2));
}

// src/render/instancing.ts
var MATRIX_SIZE = 16;
var UP = new Vector32(0, 1, 0);
var HEAD_MIN_RADII = 3;
var HEAD_MAX_SHARE = 0.8;
var SHAFT_MIN_SHARE = 0.2;
var HEAD_CENTRE_SHARE = 0.5;
var LINE_RADIUS_SHARE = 0.7;
var HARD_EDGE_ANGLE_DEG = 1;
var InstanceCollector = class {
  groups = /* @__PURE__ */ new Map();
  // Adds one instance to its group, creating the group the first time.
  add(shape, material, outlined, matrix, ref = null) {
    const key2 = `${shape}|${material}|${outlined}`;
    let group = this.groups.get(key2);
    if (!group) {
      group = { shape, material, outlined, matrices: [], refs: [] };
      this.groups.set(key2, group);
    }
    group.matrices.push(...matrix);
    group.refs.push(ref);
  }
  // A cylinder from a to b, centred on the midpoint. Two coincident ends draw nothing.
  cylinder(a2, b2, radius, material, outlined) {
    const len = span(a2, b2);
    if (len <= EPS) return;
    this.add("cylinder", material, outlined, alongMatrix(lerp(a2, b2, 0.5), vunit(vsub(b2, a2)), radius, len));
  }
  groupList() {
    return [...this.groups.values()];
  }
};
function instanceGroups(data) {
  const pos = pointPositions(data);
  const collector = new InstanceCollector();
  const { atoms, bonds, displacements } = data.primitives;
  for (const atom of atoms) {
    collector.add("sphere", atom.material_id, true, sphereMatrix(pos.get(atom.point_id), atom.radius), atom);
  }
  for (const bond of bonds) addBond(collector, bond, pos);
  for (const d2 of displacements) addDisplacement(collector, d2, pos);
  return collector.groupList();
}
function polyhedronGroups(data) {
  const pos = pointPositions(data);
  const topologies = new Map(data.topologies.map((t2) => [t2.id, t2]));
  const groups = /* @__PURE__ */ new Map();
  data.primitives.polyhedra.forEach((poly, index) => {
    const topo = topologies.get(poly.topology_id);
    const v2 = topo.point_ids.map((id) => pos.get(id));
    const group = polyhedronGroupFor(groups, poly.material_id);
    const first = group.owner.length;
    const faces = outwardFaces(v2, topo.faces);
    addFaces(group, faces, v2, index);
    for (const [a2, b2] of hardEdges(topo, pos)) group.edges.push(...a2, ...b2);
    group.ranges.push([index, first, faces.length]);
  });
  return [...groups.values()];
}
function addBond(collector, bond, pos) {
  const a2 = pos.get(bond.a_point_id);
  const b2 = pos.get(bond.b_point_id);
  const style = bond.style ?? "solid";
  if (style === "dashed") addDashes(collector, a2, b2, bond.radius, bond.material_id);
  else if (style === "dotted") addDots(collector, a2, b2, bond.radius, bond.material_id);
  else collector.cylinder(a2, b2, bond.radius, bond.material_id, true);
}
function addDashes(collector, a2, b2, radius, material) {
  const dash = Math.max(DASH.length * radius, DASH.min);
  const gap = dash * DASH.gap / DASH.length;
  for (const [start, end] of dashSegments(a2, b2, dash, gap)) collector.cylinder(start, end, radius, material, false);
}
function addDots(collector, a2, b2, radius, material) {
  const spacing = Math.max(DOT.spacing * radius, DOT.spacingMin);
  for (const centre of dotCentres(a2, b2, spacing)) {
    collector.add("dot", material, false, sphereMatrix(centre, DOT.radius * radius));
  }
}
function addDisplacement(collector, d2, pos) {
  const start = pos.get(d2.start_point_id);
  const atomIsTip = d2.anchor === "tip";
  const tail = atomIsTip ? vsub(start, d2.vector) : start;
  const tip2 = atomIsTip ? start : start.map((x2, i2) => x2 + d2.vector[i2]);
  if ((d2.mode ?? "arrow").toLowerCase() === "arrow") addArrow(collector, tail, tip2, ARROW.radius);
  else collector.cylinder(tail, tip2, ARROW.radius * LINE_RADIUS_SHARE, null, true);
}
function addArrow(collector, a2, b2, radius) {
  const len = span(a2, b2);
  if (len <= EPS) return;
  const dir = vunit(vsub(b2, a2));
  const headLen = Math.min(Math.max(len * ARROW.headLengthRatio, radius * HEAD_MIN_RADII), len * HEAD_MAX_SHARE);
  const shaftLen = Math.max(len - headLen, len * SHAFT_MIN_SHARE);
  const shaftEnd = a2.map((x2, i2) => x2 + dir[i2] * shaftLen);
  collector.cylinder(a2, shaftEnd, radius, null, true);
  const headCentre = shaftEnd.map((x2, i2) => x2 + dir[i2] * headLen * HEAD_CENTRE_SHARE);
  collector.add("cone", null, true, alongMatrix(headCentre, dir, radius * ARROW.headRadiusRatio, headLen));
}
function polyhedronGroupFor(groups, material) {
  let group = groups.get(material);
  if (!group) {
    group = { material, positions: [], edges: [], owner: [], ranges: [] };
    groups.set(material, group);
  }
  return group;
}
function outwardFaces(v2, triangles) {
  const mid = centroid(v2);
  return triangles.map(([i2, j2, k]) => {
    const n2 = vunit(vcross(vsub(v2[j2], v2[i2]), vsub(v2[k], v2[i2])));
    const faceCentre = centroid([v2[i2], v2[j2], v2[k]]);
    const outward = vdot(n2, vsub(faceCentre, mid)) >= 0;
    return outward ? { idx: [i2, j2, k], n: n2 } : { idx: [i2, k, j2], n: n2.map((x2) => -x2) };
  });
}
function centroid(v2) {
  return v2.reduce((sum, p2) => sum.map((c2, i2) => c2 + p2[i2] / v2.length), [0, 0, 0]);
}
function addFaces(group, faces, v2, index) {
  for (const f2 of faces) {
    group.positions.push(...v2[f2.idx[0]], ...v2[f2.idx[1]], ...v2[f2.idx[2]]);
    group.owner.push(index);
  }
}
function hardEdges(topo, points) {
  const v2 = topo.point_ids.map((id) => points.get(id));
  const faces = outwardFaces(v2, topo.faces);
  const sides = /* @__PURE__ */ new Map();
  for (const f2 of faces) {
    for (let e3 = 0; e3 < 3; e3++) {
      const i2 = f2.idx[e3];
      const j2 = f2.idx[(e3 + 1) % 3];
      const key2 = i2 < j2 ? `${i2}-${j2}` : `${j2}-${i2}`;
      if (!sides.has(key2)) sides.set(key2, { i: i2, j: j2, faces: [] });
      sides.get(key2).faces.push(f2);
    }
  }
  const sharpAngle = Math.cos(MathUtils.degToRad(HARD_EDGE_ANGLE_DEG));
  const edges = [];
  for (const side of sides.values()) {
    const boundary = side.faces.length === 1;
    const sharp = !boundary && vdot(side.faces[0].n, side.faces[1].n) < sharpAngle;
    if (boundary || sharp) edges.push([v2[side.i], v2[side.j]]);
  }
  return edges;
}
var isGhost = (material) => material.alpha < 1;
function pointPositions(data) {
  return new Map(data.points.map((p2) => [p2.id, p2.position]));
}
function sphereMatrix(c2, r2) {
  return [r2, 0, 0, 0, 0, r2, 0, 0, 0, 0, r2, 0, c2[0], c2[1], c2[2], 1];
}
function alongMatrix(centre, d2, radius, length2) {
  const turn = new Quaternion().setFromUnitVectors(UP, new Vector32(...d2));
  const scale = new Vector32(radius, length2, radius);
  return new Matrix4().compose(new Vector32(...centre), turn, scale).toArray();
}

// src/render/toon.ts
import * as THREE2 from "three";
var TOON_STEPS = 16;
var FIRST_LIT = Math.ceil((LOOK.threshold + 1) / 2 * TOON_STEPS);
var LIT_CUT = 2 * FIRST_LIT / TOON_STEPS - 1;
var FACE_OFFSET_FACTOR = 1;
var FACE_OFFSET_UNITS = 1;
var polygonOffsetOf = (faces) => ({
  polygonOffset: faces,
  polygonOffsetFactor: FACE_OFFSET_FACTOR,
  polygonOffsetUnits: FACE_OFFSET_UNITS
});
function makeToonGradient() {
  const texels = Array.from({ length: TOON_STEPS }, (_2, i2) => i2 >= FIRST_LIT ? 255 : 0);
  const texture = new THREE2.DataTexture(new Uint8Array(texels), TOON_STEPS, 1, THREE2.RedFormat);
  texture.minFilter = THREE2.NearestFilter;
  texture.magFilter = THREE2.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

// src/render/draw.ts
var MAX_PIXEL_RATIO = 2;
var CLIP_NEAR = 0.1;
var CLIP_FAR = 100;
var PLACEHOLDER_FOV_DEG = 30;
var OUTLINE_THICKNESS = 35e-4;
var OUTLINE_SIZE_FRACTION = 0.12;
var ATOM_SEGMENTS = { width: 48, height: 24 };
var DOT_SEGMENTS = { width: 12, height: 8 };
var TUBE_SEGMENTS = 24;
var stage = document.getElementById("stage");
var renderer = new THREE3.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setClearColor(0, 0);
stage.appendChild(renderer.domElement);
var scene = new THREE3.Scene();
var root = new THREE3.Group();
scene.add(root);
var orthoCamera = new THREE3.OrthographicCamera(-1, 1, 1, -1, CLIP_NEAR, CLIP_FAR);
var perspCamera = new THREE3.PerspectiveCamera(PLACEHOLDER_FOV_DEG, 1, CLIP_NEAR, CLIP_FAR);
perspCamera.filmGauge = GEMMY.sensorWidth;
scene.add(orthoCamera, perspCamera);
camera.value = orthoCamera;
var key = addToonLights(scene, orthoCamera);
var controls = new TrackballControls(orthoCamera, renderer.domElement);
var edgeMaterial = new THREE3.LineBasicMaterial({ color: srgbColor(LOOK.outline) });
var boxMaterial = new THREE3.LineBasicMaterial();
var MIN_OUTLINE_W = CLIP_NEAR;
var MIN_OUTLINE_DIRECTION = 1e-6;
var OUTLINE_VERTEX_SHADER = `
    uniform float outlineThickness;
    uniform float outlineScale; // the user's width (ui/outline-scale.ts): 1 is the automatic width
    // A float literal: GLSL reads a bare integer as int.
    #define OUTLINE_SIZE_FRACTION ${OUTLINE_SIZE_FRACTION.toFixed(3)}
    #define MIN_OUTLINE_W ${MIN_OUTLINE_W.toFixed(3)}
    #define MIN_OUTLINE_DIRECTION ${MIN_OUTLINE_DIRECTION.toFixed(9)}

    // The outline's width, in NDC (the image spans 2 units). The shell is pushed out by this much and then multiplied
    // by w, so the clip-space offset is the same as the constant width was when the cap does not apply.
    //   Constant width: outlineThickness, a fixed share of the image height.
    //   Cap: OUTLINE_SIZE_FRACTION times the shape's on-screen radius. A sphere of radius r at depth d projects to
    //   r * P11 / w on the screen in NDC (P11 = projectionMatrix[1][1]; w = d in perspective, w = 1 in orthographic,
    //   so there r * P11 is the radius as it is). Dividing by w by hand gives the cap in NDC; with w = 1 it is r * P11.
    //   The shell is the smaller of the two, so the outline never exceeds today's width, and it thins only where the
    //   shape is small on the screen. A plain mesh (radius 1e9) has no cap.
    float outlineWidth(float clipW, float radius) {
      float capWidth = OUTLINE_SIZE_FRACTION * radius * projectionMatrix[1][1] / clipW;
      return min(outlineThickness, capWidth);
    }

    // The shell's clip position for one vertex: the vertex moved on the screen along its outward normal by the outline
    // width. clipNormal is projectionMatrix * modelViewMatrix applied to the normal as a direction (w = 0). Moving the
    // point by t along the normal moves its clip position by t * clipNormal, so the screen position moves in the
    // direction of (clipNormal.xy * w - clipNormal.w * clip.xy), exactly, with no offset point to pick. That direction
    // is normalised in 2D, so the outline is the full width in every direction. A vertex at or behind the near plane
    // has no usable screen position, so it stays where it is.
    vec4 outlinePosition(vec4 clipPos, vec4 clipNormal, float radius) {
      if (clipPos.w <= MIN_OUTLINE_W) return clipPos;
      vec2 screenDirection = clipPos.w * clipNormal.xy - clipNormal.w * clipPos.xy;
      float length2D = length(screenDirection);
      if (!(length2D > MIN_OUTLINE_DIRECTION)) return clipPos; // also false for NaN
      float width = outlineWidth(clipPos.w, radius) * outlineScale;
      return vec4(clipPos.xy + screenDirection / length2D * width * clipPos.w, clipPos.zw);
    }

    void main() {
      vec4 local = vec4(position, 1.0);
      vec3 normalLocal = normal;
      // The instance's cross-section radius: the shorter of its X and Z columns (a cylinder's axis is local Y, and
      // a sphere has equal columns). A plain mesh has no instance, so it gets no cap.
      float radius = 1e9;
      #ifdef USE_INSTANCING
        mat3 instanceRotation = mat3(instanceMatrix);
        // dividing each column by its squared length gives the inverse transpose for a scaled instance
        vec3 columnSquared = vec3(
          dot(instanceRotation[0], instanceRotation[0]),
          dot(instanceRotation[1], instanceRotation[1]),
          dot(instanceRotation[2], instanceRotation[2]));
        normalLocal = instanceRotation * (normal / columnSquared);
        local = instanceMatrix * local;
        radius = min(length(instanceRotation[0]), length(instanceRotation[2]));
      #endif
      normalLocal = normalize(normalLocal);
      mat4 clipFromLocal = projectionMatrix * modelViewMatrix;
      gl_Position = outlinePosition(clipFromLocal * local, clipFromLocal * vec4(normalLocal, 0.0), radius);
    }`;
var OUTLINE_FRAGMENT_SHADER = `
    uniform vec3 outlineColor;
    void main() {
      gl_FragColor = vec4(outlineColor, 1.0);
      #include <colorspace_fragment>
    }`;
var outlineMaterial = new THREE3.ShaderMaterial({
  side: THREE3.BackSide,
  uniforms: {
    outlineThickness: { value: OUTLINE_THICKNESS },
    outlineScale: { value: 1 },
    // These numbers are read as linear colour (Color.fromArray) and colorspace_fragment then encodes them to sRGB, so
    // the outline shows lighter than the edges (edgeMaterial reads LOOK.outline as sRGB). Blender's Freestyle line
    // colour, set from the same numbers in renderer.py, is linear too; the render match depends on this.
    outlineColor: { value: new THREE3.Color().fromArray(LOOK.outline) }
  },
  vertexShader: OUTLINE_VERTEX_SHADER,
  fragmentShader: OUTLINE_FRAGMENT_SHADER
});
var toonGradient = makeToonGradient();
var toonMaterials = /* @__PURE__ */ new Map();
function toon(id, materials, { faces = false, ghost = false } = {}) {
  const cacheKey = `${id}|${faces}|${ghost}`;
  if (!toonMaterials.has(cacheKey)) toonMaterials.set(cacheKey, makeToon(id, materials, faces, ghost));
  return toonMaterials.get(cacheKey);
}
var SHAPES = {
  sphere: () => new THREE3.SphereGeometry(1, ATOM_SEGMENTS.width, ATOM_SEGMENTS.height),
  dot: () => new THREE3.SphereGeometry(1, DOT_SEGMENTS.width, DOT_SEGMENTS.height),
  cylinder: () => new THREE3.CylinderGeometry(1, 1, 1, TUBE_SEGMENTS, 1),
  cone: () => new THREE3.ConeGeometry(1, 1, TUBE_SEGMENTS, 1)
};
function instanced(geometry, material, matrices) {
  const mesh = new THREE3.InstancedMesh(geometry, material, matrices.length / MATRIX_SIZE);
  mesh.instanceMatrix.array.set(matrices);
  mesh.frustumCulled = false;
  return mesh;
}
function setOutlineScale(scale) {
  outlineMaterial.uniforms.outlineScale.value = scale;
}
function outlineOf(mesh) {
  if (mesh instanceof THREE3.InstancedMesh) {
    const outline2 = new THREE3.InstancedMesh(mesh.geometry, outlineMaterial, mesh.count);
    outline2.instanceMatrix = mesh.instanceMatrix;
    outline2.frustumCulled = false;
    return outline2;
  }
  const outline = new THREE3.Mesh(mesh.geometry, outlineMaterial);
  outline.frustumCulled = false;
  return outline;
}
function disposeScene() {
  root.traverse((object) => {
    object.geometry?.dispose();
    if (object instanceof THREE3.InstancedMesh) object.dispose();
  });
  for (const material of toonMaterials.values()) material.dispose();
  toonMaterials = /* @__PURE__ */ new Map();
  root.clear();
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}
function srgbColor(rgb) {
  return new THREE3.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE3.SRGBColorSpace);
}
function baseColorOf(id, materials) {
  return id === null ? ARROW.color : materials[id].base_color;
}
function alphaOf(id, materials) {
  return id === null ? 1 : materials[id].alpha ?? 1;
}
function makeToon(id, materials, faces, ghost) {
  const material = new THREE3.MeshToonMaterial({
    color: srgbColor(baseColorOf(id, materials)),
    gradientMap: toonGradient,
    ...polygonOffsetOf(faces)
  });
  if (ghost) {
    material.transparent = true;
    material.opacity = alphaOf(id, materials);
    material.depthWrite = false;
  }
  return material;
}
function addToonLights(parent, camera2) {
  parent.add(new THREE3.AmbientLight(16777215, LOOK.dark * Math.PI));
  const key2 = new THREE3.DirectionalLight(16777215, (1 - LOOK.dark) * Math.PI);
  key2.position.set(...LOOK.key);
  camera2.add(key2, key2.target);
  return key2;
}

// src/render/triad.ts
import { Color as Color2 } from "three";

// src/render/triad-layout.ts
function triadLayout(dirs, width, height) {
  const T2 = GEMMY.triad;
  const length2 = T2.size * Math.min(width, height);
  const origin = [T2.margin * width, height - T2.margin * height];
  const items = dirs.map((d2, index) => triadItem(d2, index, origin, length2)).sort((p2, q) => p2.depth - q.depth);
  return {
    origin,
    items,
    behind: items.filter((item) => item.depth < 0).length,
    lineWidth: 2 * T2.arrowRadius * length2,
    fontSize: T2.labelSize * length2,
    dotRadius: T2.dotRadius * length2,
    length: length2
  };
}
var LABEL_FLAT_MIN = 0.15;
var HEAD_FLAT_MIN = 0.08;
var DIAGONAL = Math.SQRT1_2;
function triadItem(d2, index, origin, length2) {
  const T2 = GEMMY.triad;
  const flat = Math.hypot(d2[0], d2[1]);
  const onScreen2 = flat > LABEL_FLAT_MIN;
  const [ux, uy] = labelDirection(d2, flat, onScreen2);
  const labelRadius = length2 * (1 + T2.labelReach * T2.arrowRadius);
  const reach = onScreen2 ? labelRadius * flat : 0;
  const pad = T2.labelPad * length2;
  const label = { x: origin[0] + (reach + pad) * ux, y: origin[1] - (reach + pad) * uy };
  const fade = T2.depthFadeMax * Math.max(0, -d2[2]);
  return flat > HEAD_FLAT_MIN ? { index, depth: d2[2], fade, label, ...triadArrow(d2, flat, origin, length2) } : { index, depth: d2[2], fade, label };
}
function labelDirection(d2, flat, onScreen2) {
  return onScreen2 ? [d2[0] / flat, d2[1] / flat] : [DIAGONAL, DIAGONAL];
}
var SHAFT_INTO_HEAD = 0.5;
function triadArrow(d2, flat, [ox, oy], length2) {
  const T2 = GEMMY.triad;
  const tip2 = [ox + d2[0] * length2, oy - d2[1] * length2];
  const tx = d2[0] / flat;
  const ty = -d2[1] / flat;
  const headLength = T2.headLengthRatio * length2;
  const headHalf = T2.headRadiusRatio * T2.arrowRadius * length2;
  const base = [tip2[0] - tx * headLength, tip2[1] - ty * headLength];
  return {
    shaftEnd: [tip2[0] - tx * headLength * SHAFT_INTO_HEAD, tip2[1] - ty * headLength * SHAFT_INTO_HEAD],
    head: [tip2, [base[0] - ty * headHalf, base[1] + tx * headHalf], [base[0] + ty * headHalf, base[1] - tx * headHalf]]
  };
}
function latticeInView(lattice, orientation) {
  const inverse = orientation.clone().invert();
  return lattice.map((vector) => vector.clone().applyQuaternion(inverse).toArray());
}

// src/render/triad.ts
var FONT_LOAD_PX = 16;
var AXIS_FONT_STYLE = "italic 700";
var triadCanvas = document.getElementById("triad");
var triadContext = triadCanvas.getContext("2d");
for (const [weight, base64] of Object.entries(AXIS_FONT.faces)) {
  document.fonts.add(
    new FontFace(AXIS_FONT.family, `url(data:font/ttf;base64,${base64})`, { style: "italic", weight })
  );
}
var axisFontReady = false;
document.fonts.load(`${AXIS_FONT_STYLE} ${FONT_LOAD_PX}px "${AXIS_FONT.family}"`).finally(() => {
  axisFontReady = true;
  requestRender();
});
function drawLiveTriad() {
  drawTriad(triadCanvas, triadContext, Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO), false);
}
function drawTriad(canvas, ctx, dpr, transparent) {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  sizeCanvas(canvas, width, height, dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!axisFontReady) return;
  const lattice = latticeInView(loaded.value.lattice, camera.value.quaternion);
  const background = transparent ? null : cssVar("--bg").trim();
  drawLetters(ctx, triadLayout(lattice, width, height), background);
}
function drawLetters(ctx, triad, background) {
  for (const item of triad.items) drawLetter(ctx, item, triad.fontSize, background);
}
function drawLetter(ctx, item, fontSize, background) {
  const base = LOOK.axisColors[item.index];
  ctx.save();
  if (background === null) {
    ctx.globalAlpha = 1 - item.fade;
    ctx.fillStyle = base;
  } else {
    ctx.fillStyle = new Color2(base).lerp(new Color2(background), item.fade).getStyle();
  }
  ctx.font = `${AXIS_FONT_STYLE} ${fontSize}px ${cssVar("--label")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(AXIS_LETTERS[item.index], item.label.x, item.label.y);
  ctx.restore();
}
function sizeCanvas(canvas, width, height, dpr) {
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

// src/camera/view.ts
import * as THREE4 from "three";

// src/camera/framing.ts
import { Quaternion as Quaternion2, Vector3 as Vector33 } from "three";
var baseDistance = (extent2) => Math.max(GEMMY.distanceFactor * extent2, GEMMY.distanceMin);
var orthoSide = (extent2) => Math.max(GEMMY.orthoFactor * extent2, GEMMY.orthoMin);
var ORTHO_VIEW_DISTANCE = 8;
function orthoFrame(extent2, width, height) {
  const side = orthoSide(extent2);
  const larger = Math.max(width, height);
  return { halfWidth: side / 2 * (width / larger), halfHeight: side / 2 * (height / larger) };
}
var RAD_TO_DEG = 180 / Math.PI;
function perspFov(lens2, width, height) {
  const halfSensor = 0.5 * GEMMY.sensorWidth / Math.max(width / height, 1);
  return 2 * Math.atan(halfSensor / lens2) * RAD_TO_DEG;
}
function fitZoomPersp(extent2, lens2, width, height) {
  const shorterSensor = GEMMY.sensorWidth * Math.min(width, height) / Math.max(width, height);
  const halfAngle = Math.atan(shorterSensor / 2 / lens2);
  return baseDistance(extent2) * Math.sin(halfAngle) / (orthoSide(extent2) / 2);
}
var fitZoom = (width, height) => Math.min(width, height) / Math.max(width, height);
var orthoToPerspZoom = (extent2, lens2, zoom2) => baseDistance(extent2) * GEMMY.sensorWidth * zoom2 / (orthoSide(extent2) * lens2);
var perspToOrthoZoom = (extent2, lens2, zoom2) => zoom2 * orthoSide(extent2) * lens2 / (baseDistance(extent2) * GEMMY.sensorWidth);
var CAMERA_FORWARD = [0, 0, -1];
var viewForward = (quaternion) => applyQuaternion(quaternion, CAMERA_FORWARD);
var flyShift = (quaternion, distance) => viewForward(quaternion).map((x2) => x2 * distance);
var CLIP_MARGIN_IN_FRONT = 1;
var CLIP_MARGIN_BEHIND = 2;
var NEAREST_CLIP = 0.01;
var depthOfCentre = (position, quaternion) => -vdot(position, viewForward(quaternion));
function clipPlanesAround(depth, structureExtent) {
  const radius = structureExtent / 2;
  return {
    near: Math.max(depth - radius - CLIP_MARGIN_IN_FRONT * structureExtent, NEAREST_CLIP),
    far: depth + radius + CLIP_MARGIN_BEHIND * structureExtent
  };
}
function applyQuaternion(q, v2) {
  return new Vector33(...v2).applyQuaternion(new Quaternion2().fromArray(q)).toArray();
}

// src/camera/view-state.ts
import { Matrix4 as Matrix42, MathUtils as MathUtils2, Quaternion as Quaternion3, Vector3 as Vector34 } from "three";
var ZOOM_MIN = 0.05;
var ZOOM_MAX = 40;
var orbitDistance = (view2, extent2) => view2.projection === "persp" ? baseDistance(extent2) / view2.zoom : extent2 * ORTHO_VIEW_DISTANCE;
var backAxis = (orientation) => applyQuaternion(orientation, [0, 0, 1]);
var upAxis = (orientation) => applyQuaternion(orientation, [0, 1, 0]);
var cameraPosition = (view2, extent2) => vadd(view2.target, vscale(backAxis(view2.orientation), orbitDistance(view2, extent2)));
function shownZoom(view2, extent2) {
  if (view2.projection !== "persp") return view2.zoom;
  return baseDistance(extent2) / Math.hypot(...cameraPosition(view2, extent2));
}
function frameZoom(projection2, lens2, size, extent2, frame3) {
  if (projection2 === "persp") {
    return fitZoomPersp(size, lens2, frame3.width, frame3.height) * (baseDistance(extent2) / baseDistance(size));
  }
  return fitZoom(frame3.width, frame3.height) * orthoSide(extent2) / orthoSide(size);
}
var fitZoomFor = (projection2, lens2, extent2, frame3) => frameZoom(projection2, lens2, extent2, extent2, frame3);
function visibleHeight(view2, extent2, frame3) {
  if (view2.projection === "persp") {
    const halfAngle = perspFov(view2.lens, frame3.width, frame3.height) * MathUtils2.DEG2RAD / 2;
    return 2 * orbitDistance(view2, extent2) * Math.tan(halfAngle);
  }
  return 2 * orthoFrame(extent2, frame3.width, frame3.height).halfHeight / view2.zoom;
}
function orientationFromBasis(back, up) {
  const basis = new Matrix42().lookAt(new Vector34(...back), new Vector34(0, 0, 0), new Vector34(...up));
  return new Quaternion3().setFromRotationMatrix(basis).toArray();
}
function dollied(view2, wanted, extent2) {
  const towards = backAxis(view2.orientation);
  const along = vdot(view2.target, towards);
  const discriminant = along * along - (vdot(view2.target, view2.target) - (baseDistance(extent2) / wanted) ** 2);
  const roots = discriminant < 0 ? [-along] : [-along - Math.sqrt(discriminant), -along + Math.sqrt(discriminant)];
  const ahead = roots.filter((s2) => s2 > 0);
  if (!ahead.length) return view2;
  const current = orbitDistance(view2, extent2);
  const nearest = ahead.reduce((best, s2) => Math.abs(s2 - current) < Math.abs(best - current) ? s2 : best);
  const distance = MathUtils2.clamp(nearest, baseDistance(extent2) / ZOOM_MAX, baseDistance(extent2) / ZOOM_MIN);
  return { ...view2, zoom: baseDistance(extent2) / distance };
}
function zoomedTo(view2, wanted, extent2) {
  const level = MathUtils2.clamp(wanted, ZOOM_MIN, ZOOM_MAX);
  return view2.projection === "persp" ? dollied(view2, level, extent2) : { ...view2, zoom: level };
}
function rotated(view2, screenAxis, degrees) {
  const world = new Vector34(...applyQuaternion(view2.orientation, screenAxis));
  const turn = new Quaternion3().setFromAxisAngle(world, degrees * MathUtils2.DEG2RAD);
  return { ...view2, orientation: turn.multiply(new Quaternion3().fromArray(view2.orientation)).toArray() };
}
function panned(view2, dx, dy, fraction, extent2, frame3) {
  const amount = visibleHeight(view2, extent2, frame3) * fraction;
  return { ...view2, target: vadd(view2.target, applyQuaternion(view2.orientation, [-dx * amount, -dy * amount, 0])) };
}
var flown = (view2, distance) => ({
  ...view2,
  target: vadd(view2.target, flyShift(view2.orientation, distance))
});
function framed(view2, centre, size, extent2, frame3) {
  const zoom2 = frameZoom(view2.projection, view2.lens, size, extent2, frame3);
  return { ...view2, target: [...centre], zoom: zoom2 };
}
function viewedFrom(view2, direction, up) {
  return {
    ...view2,
    target: [0, 0, 0],
    orientation: orientationFromBasis(direction, up),
    zoom: view2.projection === "persp" ? 1 : view2.zoom
  };
}
function pivoted(view2, hitDistance, minDistance, extent2) {
  const position = cameraPosition(view2, extent2);
  const distance = Math.max(hitDistance, minDistance);
  if (distance >= span(position, view2.target)) return null;
  return {
    ...view2,
    target: vadd(position, vscale(viewForward(view2.orientation), distance)),
    zoom: baseDistance(extent2) / distance
  };
}
function released(view2, extent2, minDistance, maxDistance) {
  const position = cameraPosition(view2, extent2);
  const along = MathUtils2.clamp(depthOfCentre(position, view2.orientation), minDistance, maxDistance);
  return {
    ...view2,
    target: vadd(position, vscale(viewForward(view2.orientation), along)),
    zoom: view2.projection === "persp" ? baseDistance(extent2) / along : view2.zoom
  };
}
function withProjection(view2, projection2, lens2, extent2, frame3) {
  if (projection2 === view2.projection && (projection2 === "ortho" || lens2 === view2.lens)) return { ...view2, lens: lens2 };
  const fitted = Math.abs(shownZoom(view2, extent2) - fitZoomFor(view2.projection, view2.lens, extent2, frame3)) < EPS;
  const orthoZoom = view2.projection === "persp" ? perspToOrthoZoom(extent2, view2.lens, view2.zoom) : view2.zoom;
  const zoom2 = projection2 === "persp" ? orthoToPerspZoom(extent2, lens2, orthoZoom) : orthoZoom;
  const next = { ...view2, projection: projection2, lens: lens2 };
  return { ...next, zoom: fitted ? fitZoomFor(projection2, lens2, extent2, frame3) : zoom2 };
}
function interpolated(from, to, share) {
  return {
    target: lerp(from.target, to.target, share),
    orientation: new Quaternion3().fromArray(from.orientation).slerp(new Quaternion3().fromArray(to.orientation), share).toArray(),
    zoom: from.zoom * (to.zoom / from.zoom) ** share,
    projection: to.projection,
    lens: to.lens
  };
}

// src/camera/view.ts
var GLIDE_MS = 300;
var CLIP_CHANGE_TOLERANCE = 1e-6;
var view = {
  target: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  zoom: 1,
  projection: "ortho",
  lens: GEMMY.defaultLens
};
var glideId = 0;
var isPersp = () => view.projection === "persp";
var frameSize = () => ({ width: stage.clientWidth, height: stage.clientHeight });
var extentNow = () => loaded.value.extent;
var refit = () => {
  fitValue.value = fitFor(stage.clientWidth, stage.clientHeight);
};
function viewNow() {
  readBack();
  return view;
}
function pageCamera() {
  return {
    quaternion: camera.value.quaternion.toArray(),
    zoom: viewNow().zoom,
    target: controls.target.toArray(),
    projection: projection.value,
    lens: lens.value,
    width: stage.clientWidth,
    height: stage.clientHeight
  };
}
var shownNow = () => shownZoom(viewNow(), extentNow());
var fitFor = (width, height) => fitZoomFor(view.projection, view.lens, extentNow(), { width, height });
function readBack() {
  const cam = camera.value;
  const persp = cam === perspCamera;
  const target = controls.target.toArray();
  const distance = span(cam.position.toArray(), target);
  let zoom2 = cam.zoom;
  if (persp) zoom2 = distance === 0 ? 1 : baseDistance(extentNow()) / distance;
  view = {
    ...view,
    target,
    orientation: cam.quaternion.toArray(),
    projection: persp ? "persp" : "ortho",
    zoom: zoom2
  };
}
function applyView() {
  const cam = view.projection === "persp" ? perspCamera : orthoCamera;
  if (camera.peek() !== cam) {
    camera.value = cam;
    cam.add(key, key.target);
    controls.object = cam;
  }
  cam.position.fromArray(cameraPosition(view, extentNow()));
  cam.quaternion.fromArray(view.orientation);
  cam.up.fromArray(upAxis(view.orientation));
  controls.target.fromArray(view.target);
  cam.zoom = view.projection === "persp" ? 1 : view.zoom;
  cam.updateProjectionMatrix();
}
function commit(next) {
  if (next.lens !== view.lens) perspCamera.setFocalLength(next.lens);
  r(() => {
    view = next;
    lens.value = next.lens;
    projection.value = next.projection;
    applyView();
  });
  requestRender();
}
function move(change) {
  glideId++;
  commit(change(viewNow()));
}
function setView(next) {
  glideId++;
  commit(next);
  refit();
}
function syncClip() {
  if (!isPersp()) return;
  const cam = camera.value;
  const depth = depthOfCentre(cam.position.toArray(), cam.quaternion.toArray());
  const { near, far } = clipPlanesAround(depth, extentNow());
  if (Math.abs(cam.near - near) > CLIP_CHANGE_TOLERANCE || Math.abs(cam.far - far) > CLIP_CHANGE_TOLERANCE) {
    Object.assign(cam, { near, far });
    cam.updateProjectionMatrix();
  }
}
var zoom = (factor) => move((s2) => zoomedTo(s2, shownZoom(s2, extentNow()) * factor, extentNow()));
var zoomTo = (level) => move((s2) => zoomedTo(s2, level, extentNow()));
var SCREEN_AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
function isScreenAxis(name) {
  return name !== void 0 && Object.hasOwn(SCREEN_AXES, name);
}
function rotate(axis, degrees) {
  move((s2) => rotated(s2, SCREEN_AXES[axis], degrees));
}
function viewFrom(dir, up) {
  move((s2) => viewedFrom(s2, dir.toArray(), up.toArray()));
}
function pan(dx, dy, fraction) {
  move((s2) => panned(s2, dx, dy, fraction, extentNow(), frameSize()));
}
function flyForward(fraction) {
  move((s2) => flown(s2, visibleHeight(s2, extentNow(), frameSize()) * fraction));
}
function fit() {
  move((s2) => framed(s2, [0, 0, 0], extentNow(), extentNow(), frameSize()));
  refit();
}
function pivotTo(hitDistance, minDistance) {
  const next = pivoted(viewNow(), hitDistance, minDistance, extentNow());
  if (next) move(() => next);
  return next !== null;
}
function releaseTo(minDistance, maxDistance) {
  move((s2) => released(s2, extentNow(), minDistance, maxDistance));
}
function switchProjection(mode2, newLens = lens.value) {
  move((s2) => withProjection(s2, mode2, newLens, extentNow(), frameSize()));
  refit();
}
function glideTo(end) {
  const id = ++glideId;
  const start = viewNow();
  const started = performance.now();
  const step = () => {
    if (id !== glideId) return;
    const progress = (performance.now() - started) / GLIDE_MS;
    commit(progress >= 1 ? end : interpolated(start, end, THREE4.MathUtils.smoothstep(progress, 0, 1)));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function centreOn(centre, size) {
  glideTo(framed(viewNow(), centre.toArray(), size, extentNow(), frameSize()));
}
function glideTarget(point) {
  glideTo({ ...viewNow(), target: point.toArray() });
}
controls.addEventListener("start", () => {
  glideId++;
});

// src/camera/fly.ts
var MS_PER_SECOND = 1e3;
var MAX_FRAME_SECONDS = 0.05;
var FIRST_STEP_SECONDS = 1 / 60;
var flying = /* @__PURE__ */ new Set();
var flyLast = 0;
var shiftHeld = false;
var FLY = {
  KeyW: ["fly", 1],
  KeyS: ["fly", -1],
  KeyA: ["pan", 1, 0],
  KeyD: ["pan", -1, 0],
  KeyE: ["pan", 0, -1],
  KeyQ: ["pan", 0, 1]
};
var FLY_SHIFT = { KeyW: ["pan", 0, -1], KeyS: ["pan", 0, 1] };
function setShiftHeld(held) {
  shiftHeld = held;
}
function moveFor(code) {
  return shiftHeld && FLY_SHIFT[code] || FLY[code];
}
function advance(direction, seconds) {
  if (isPersp()) flyForward(direction * RATE.pan * seconds);
  else zoom(RATE.zoom ** (direction * seconds));
}
function fly(now) {
  if (!flying.size) {
    flyLast = 0;
    return;
  }
  const seconds = flyLast ? Math.min((now - flyLast) / MS_PER_SECOND, MAX_FRAME_SECONDS) : FIRST_STEP_SECONDS;
  flyLast = now;
  for (const code of flying) {
    const move2 = moveFor(code);
    if (move2[0] === "fly") advance(move2[1], seconds);
    else pan(move2[1], move2[2], RATE.pan * seconds);
  }
}
function wireFlyKeys() {
  window.addEventListener("keyup", (e3) => {
    flying.delete(e3.code);
    setShiftHeld(e3.shiftKey);
  });
  window.addEventListener("blur", () => {
    flying.clear();
    setShiftHeld(false);
  });
}

// src/ui/picking.ts
import * as THREE6 from "three";

// src/ui/readout.ts
import * as THREE5 from "three";

// src/ui/dom.ts
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`gemmy viewer: the page has no #${id}`);
  return element;
}
function closestOf(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}
function cloneTemplate(id) {
  return byId(id).content.cloneNode(true);
}
function setSlot(root2, name, text) {
  root2.querySelector(`[data-slot="${name}"]`).textContent = text;
}
var nameHeading = document.querySelector(".name h1");
var nameLine = document.querySelector(".name .sub");
var pageName = {
  read() {
    return { name: nameHeading.textContent, from: nameLine.textContent };
  },
  show(name, from) {
    nameHeading.textContent = name;
    nameLine.textContent = from;
  }
};

// src/ui/readout.ts
var info = byId("info-body");
var ANGSTROM_DIGITS = 3;
var FRACTIONAL_DIGITS = 4;
var DELTA_SCALE = 1e4;
var COPY_FEEDBACK_MS = 1500;
var SUBSCRIPT_DIGITS = "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089";
function dist(a2, b2) {
  return new THREE5.Vector3(...a2).distanceTo(new THREE5.Vector3(...b2));
}
function pointOf(id) {
  const point = loaded.value.points.get(id);
  if (!point) throw new Error(`gemmy viewer: the scene has no point ${id}`);
  return point;
}
function formatDigits(x2, digits = ANGSTROM_DIGITS) {
  return x2.toFixed(digits);
}
function average(xs) {
  return xs.reduce((sum, x2) => sum + x2, 0) / xs.length;
}
function subscripts(s2) {
  return s2.replace(/\d+/g, (m2) => [...m2].map((c2) => SUBSCRIPT_DIGITS[Number(c2)]).join(""));
}
function grouped(values) {
  const counts = /* @__PURE__ */ new Map();
  for (const x2 of values) counts.set(formatDigits(x2), (counts.get(formatDigits(x2)) || 0) + 1);
  return [...counts].sort((p2, q) => Number(p2[0]) - Number(q[0])).map(([x2, n2]) => n2 > 1 ? `${n2} \xD7 ${x2}` : x2).join(", ");
}
function dropRow(root2, row) {
  for (const element of root2.querySelectorAll(`[data-row="${row}"]`)) element.remove();
}
function objectBounds(target) {
  const offset = new THREE5.Vector3(...loaded.value.centre);
  if (target.kind === "atom") {
    const position = new THREE5.Vector3(...pointOf(target.atom.point_id).position).sub(offset);
    return { centre: position, size: 2 * target.atom.radius };
  }
  const corners = target.poly.ligand_point_ids.map((id) => new THREE5.Vector3(...pointOf(id).position));
  const box = new THREE5.Box3().setFromPoints(corners);
  return { centre: box.getCenter(new THREE5.Vector3()).sub(offset), size: box.min.distanceTo(box.max) };
}
function polyhedronReadout(p2) {
  const centre = pointOf(p2.center_point_id);
  const bonds = p2.ligand_point_ids.map((id) => dist(centre.position, pointOf(id).position));
  const mean = average(bonds);
  const distortion = average(bonds.map((x2) => ((x2 - mean) / mean) ** 2));
  const centreText = centre.fractional ? `${centre.element} at (${centre.fractional.map((x2) => formatDigits(x2, FRACTIONAL_DIGITS)).join(", ")})` : centre.element;
  const root2 = cloneTemplate("polyhedron-readout");
  setSlot(root2, "name", subscripts(p2.name ?? "Polyhedron"));
  setSlot(root2, "centre", centreText);
  setSlot(root2, "bonds", grouped(bonds));
  setSlot(root2, "mean", formatDigits(mean));
  setSlot(root2, "delta", (distortion * DELTA_SCALE).toFixed(2));
  root2.querySelector('[data-slot="view"]').append(cloneTemplate("center-button"));
  return root2;
}
function atomReadout(a2) {
  const point = pointOf(a2.point_id);
  const hosts = loaded.value.polyhedra.filter((p2) => p2.ligand_point_ids.includes(a2.point_id));
  const neighbours = hosts.map((p2) => dist(point.position, pointOf(p2.center_point_id).position));
  const root2 = cloneTemplate("atom-readout");
  setSlot(root2, "element", point.element);
  if (point.ref) {
    setSlot(root2, "ref", point.ref);
    root2.querySelector('[data-slot="copy"]').dataset.copy = point.ref;
  } else dropRow(root2, "ref");
  if (point.fractional)
    setSlot(root2, "fractional", point.fractional.map((x2) => formatDigits(x2, FRACTIONAL_DIGITS)).join(", "));
  else dropRow(root2, "fractional");
  setSlot(root2, "cartesian", point.position.map((x2) => formatDigits(x2)).join(", "));
  if (hosts.length) {
    setSlot(root2, "host", pointOf(hosts[0].center_point_id).element);
    setSlot(root2, "neighbours", grouped(neighbours));
  } else dropRow(root2, "neighbours");
  root2.querySelector('[data-slot="view"]').append(cloneTemplate("center-button"));
  return root2;
}
var shown = null;
function describe(target) {
  shown = target;
  if (!target) info.replaceChildren(cloneTemplate("nothing-selected"));
  else if (target.kind === "polyhedron") info.replaceChildren(polyhedronReadout(target.poly));
  else info.replaceChildren(atomReadout(target.atom));
}
function copyRef(button) {
  const done = (text) => {
    button.textContent = text;
    setTimeout(() => {
      button.textContent = "Copy";
    }, COPY_FEEDBACK_MS);
  };
  try {
    navigator.clipboard.writeText(button.dataset.copy ?? "").then(
      () => done("Copied"),
      () => done("Failed")
    );
  } catch {
    done("Failed");
  }
}
function wireReadout() {
  info.addEventListener("click", (e3) => {
    const button = closestOf(e3.target, "button[data-copy]");
    if (button) copyRef(button);
    else if (closestOf(e3.target, "button[data-center]") && shown) {
      const { centre, size } = objectBounds(shown);
      centreOn(centre, size);
    }
  });
}

// src/ui/storage.ts
function remembered(key2, parse) {
  return {
    read() {
      try {
        return parse(localStorage.getItem(key2));
      } catch {
        return parse(null);
      }
    },
    write(value) {
      try {
        localStorage.setItem(key2, String(value));
      } catch {
      }
    }
  };
}

// src/ui/panels.ts
var PHONE_MAX_WIDTH = 640;
var narrowScreen = matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
var choiceStore = (key2) => remembered(key2, (raw) => raw === "1" || raw === "0" ? raw : null);
var asChoice = (open) => open ? "1" : "0";
var isOpen = (choice) => choice === null ? null : choice === "1";
var INFO_KEY = "gemmy.info-open";
var infoPanel = byId("info");
var infoButton = byId("info-button");
var infoClose = byId("info-close");
var infoStore = choiceStore(INFO_KEY);
var rememberedInfo = isOpen(infoStore.read());
function infoChoice() {
  return rememberedInfo;
}
function showInfo(open) {
  if (open && narrowScreen.matches) showViewControls(false);
  infoPanel.hidden = !open;
  infoButton.hidden = open;
  infoButton.setAttribute("aria-expanded", String(open));
}
function toggleInfo() {
  const open = infoPanel.hidden;
  showInfo(open);
  rememberedInfo = open;
  infoStore.write(asChoice(open));
  (open ? infoClose : infoButton).focus({ preventScroll: true });
}
var VIEW_CONTROLS_KEY = "gemmy.view-controls-open";
var viewBar = byId("bottom");
var viewToggle = byId("view-toggle");
var viewStore = choiceStore(VIEW_CONTROLS_KEY);
var viewOpen = isOpen(viewStore.read()) ?? !narrowScreen.matches;
function showViewControls(open) {
  viewBar.classList.toggle("folded", !open);
  viewToggle.setAttribute("aria-expanded", String(open));
}
function wirePanels() {
  infoButton.addEventListener("click", toggleInfo);
  infoClose.addEventListener("click", toggleInfo);
  showViewControls(viewOpen);
  viewToggle.addEventListener("click", () => {
    viewOpen = !viewOpen;
    if (viewOpen && narrowScreen.matches && !infoPanel.hidden) showInfo(false);
    showViewControls(viewOpen);
    viewStore.write(asChoice(viewOpen));
  });
}

// src/ui/picking.ts
var HIGHLIGHT_GLOW = 0.55;
var PULL_FORWARD = -1;
var GHOST_RENDER_ORDER = 2;
var FLOATS_PER_TRIANGLE = 3 * 3;
var highlight = null;
function clearHighlight() {
  if (!highlight) return;
  highlight.removeFromParent();
  highlight.material.dispose();
  if (highlight.userData.own) highlight.geometry.dispose();
  highlight = null;
}
function highlightMaterial(base) {
  const material = base.clone();
  material.emissive = base.color.clone().multiplyScalar(HIGHLIGHT_GLOW);
  Object.assign(material, { polygonOffset: true, polygonOffsetFactor: PULL_FORWARD, polygonOffsetUnits: PULL_FORWARD });
  return material;
}
function highlightAtom(target) {
  const mesh = new THREE6.Mesh(target.mesh.geometry, highlightMaterial(target.mesh.material));
  target.mesh.getMatrixAt(target.index, mesh.matrix);
  mesh.matrixAutoUpdate = false;
  loaded.value.atomGroup.add(mesh);
  return mesh;
}
function highlightPolyhedron(target) {
  const from = target.first * FLOATS_PER_TRIANGLE, to = (target.first + target.count) * FLOATS_PER_TRIANGLE;
  const geometry = new THREE6.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const values = target.mesh.geometry.getAttribute(name).array.slice(from, to);
    geometry.setAttribute(name, new THREE6.Float32BufferAttribute(values, 3));
  }
  const mesh = new THREE6.Mesh(geometry, highlightMaterial(target.mesh.material));
  mesh.userData.own = true;
  mesh.renderOrder = target.ghost ? GHOST_RENDER_ORDER : 0;
  loaded.value.polyGroup.add(mesh);
  return mesh;
}
function select(target) {
  clearHighlight();
  if (target) highlight = target.kind === "atom" ? highlightAtom(target) : highlightPolyhedron(target);
  describe(target);
  requestRender();
}
function targetOf(hit) {
  const mesh = hit.object;
  if (mesh.userData.atoms) {
    const index = hit.instanceId;
    return { kind: "atom", atom: mesh.userData.atoms[index], mesh, index };
  }
  const face = hit.faceIndex;
  return loaded.value.polyTargets[mesh.userData.owner[face]];
}
function pickableObjects() {
  const { atomGroup, polyGroup } = loaded.value;
  const atoms = atomGroup.visible ? atomGroup.children.filter((o2) => o2.userData.atoms) : [];
  const polys = polyGroup.children.filter((o2) => o2.isMesh && o2.userData.owner);
  return [...atoms, ...polys];
}
var ray = new THREE6.Raycaster();
function hitAt(clientX, clientY) {
  const r2 = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE6.Vector2((clientX - r2.left) / r2.width * 2 - 1, -((clientY - r2.top) / r2.height) * 2 + 1);
  ray.setFromCamera(ndc, camera.value);
  const hits = ray.intersectObjects(pickableObjects(), false);
  return hits.find((h2) => !isGhostHit(h2)) ?? hits[0] ?? null;
}
function isGhostHit(hit) {
  const target = targetOf(hit);
  return target.kind === "polyhedron" && target.ghost;
}
function pickPointAt(clientX, clientY) {
  const hit = hitAt(clientX, clientY);
  return hit ? hit.point.clone() : null;
}
var DOUBLE_CLICK_MS = 350;
var DOUBLE_CLICK_SLOP_PX = 10;
var pressedAt = null;
var lastClick = null;
function completesDoubleClick(e3) {
  const previous = lastClick;
  lastClick = { at: e3.timeStamp, x: e3.clientX, y: e3.clientY };
  if (!previous) return false;
  const quick = e3.timeStamp - previous.at <= DOUBLE_CLICK_MS;
  const near = Math.hypot(e3.clientX - previous.x, e3.clientY - previous.y) <= DOUBLE_CLICK_SLOP_PX;
  if (!quick || !near) return false;
  lastClick = null;
  return true;
}
function wirePicking(releaseRotation) {
  renderer.domElement.addEventListener("pointerdown", (e3) => {
    pressedAt = [e3.clientX, e3.clientY];
  });
  renderer.domElement.addEventListener("pointerup", (e3) => {
    if (!pressedAt) return;
    if (Math.hypot(e3.clientX - pressedAt[0], e3.clientY - pressedAt[1]) > POINTER_SLOP_PX) return;
    const double = completesDoubleClick(e3);
    const hit = hitAt(e3.clientX, e3.clientY);
    select(hit ? targetOf(hit) : null);
    if (hit) showInfo(true);
    if (double && hit) glideTarget(hit.point);
    else if (!hit) releaseRotation();
  });
}

// src/ui/pivot.ts
function beginRotation() {
  if (!cameraInsideStructure()) return;
  const r2 = renderer.domElement.getBoundingClientRect();
  const hit = pickPointAt(r2.left + r2.width / 2, r2.top + r2.height / 2);
  if (!hit) return;
  pivotTo(hit.distanceTo(camera.value.position), controls.minDistance);
}
function releasePivot() {
  releaseTo(controls.minDistance, controls.maxDistance);
}
function cameraInsideStructure() {
  const { extent: extent2 } = loaded.value;
  return span(cameraPosition(viewNow(), extent2), [0, 0, 0]) < extent2 / 2;
}
var press = null;
window.addEventListener(
  "pointerdown",
  (e3) => {
    press = e3.button === 0 && e3.target === renderer.domElement ? { x: e3.clientX, y: e3.clientY, armed: false } : null;
  },
  { capture: true }
);
controls.addEventListener("start", () => {
  if (press) press.armed = true;
});
window.addEventListener(
  "pointermove",
  (e3) => {
    if (!press?.armed) return;
    if (Math.hypot(e3.clientX - press.x, e3.clientY - press.y) <= POINTER_SLOP_PX) return;
    press.armed = false;
    beginRotation();
  },
  { capture: true }
);
for (const ending of ["pointerup", "pointercancel"]) {
  window.addEventListener(
    ending,
    () => {
      press = null;
    },
    { capture: true }
  );
}

// src/ui/menus.ts
import { MathUtils as MathUtils8 } from "three";

// src/scene/read.ts
var SCENE_FILE = /\.json(\.gz)?$/i;
var MEGABYTE = 1024 * 1024;
var MAX_SCENE_BYTES = 200 * MEGABYTE;
var GZIP_FIRST_BYTE = 31;
var GZIP_SECOND_BYTE = 139;
var SceneError = class extends Error {
};
var messageOf = (error) => error instanceof Error ? error.message : String(error);
var isObject = (value) => typeof value === "object" && value !== null;
function isGzip(bytes) {
  return bytes[0] === GZIP_FIRST_BYTE && bytes[1] === GZIP_SECOND_BYTE;
}
async function readCapped(stream, what) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SCENE_BYTES) {
      await reader.cancel();
      throw new SceneError(`${what} is larger than ${MAX_SCENE_BYTES / MEGABYTE} MB.`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}
async function sceneText(bytes) {
  if (!isGzip(bytes)) return new TextDecoder().decode(bytes);
  let plain;
  try {
    const unzipped = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    plain = await readCapped(unzipped, "The decompressed scene");
  } catch (error) {
    if (error instanceof SceneError) throw error;
    throw new SceneError(`The gzip data could not be read: ${messageOf(error)}`);
  }
  return new TextDecoder().decode(plain);
}
async function sceneFromBytes(bytes) {
  return parseScene(await sceneText(bytes));
}
async function sceneFromFile(file) {
  if (!SCENE_FILE.test(file.name)) throw new SceneError(`${file.name} is not a .json or .json.gz scene file.`);
  if (file.size > MAX_SCENE_BYTES)
    throw new SceneError(`${file.name} is larger than ${MAX_SCENE_BYTES / MEGABYTE} MB.`);
  return sceneFromBytes(new Uint8Array(await file.arrayBuffer()));
}
function parseScene(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SceneError(`The scene is not valid JSON: ${messageOf(error)}`);
  }
  return checkScene(value);
}
function checkScene(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SceneError("The JSON is not a gemmy scene (it is not an object).");
  }
  const { schema_version: version } = value;
  if (version !== GEMMY.sceneSchemaVersion) {
    throw new SceneError(
      `This scene has schema_version ${String(version)}; this viewer reads version ${GEMMY.sceneSchemaVersion}. Compile it again with this gemmy.`
    );
  }
  const doc = value;
  if (!Array.isArray(doc.points) || !isObject(doc.primitives) || !isObject(doc.materials)) {
    throw new SceneError(
      "The JSON has a schema_version but no points, primitives and materials: it is not a gemmy scene."
    );
  }
  return doc;
}

// src/scene/gist.ts
function pickGistFile(files, wanted) {
  const all = Object.values(files);
  if (wanted !== null) {
    const named = all.find((file) => file.filename === wanted);
    if (!named) throw new Error(`The gist has no file named "${wanted}".`);
    return named;
  }
  const scene2 = all.find((file) => SCENE_FILE.test(file.filename));
  if (!scene2) throw new Error("The gist has no .json or .json.gz file.");
  return scene2;
}

// src/scene/source.ts
var SCENE_PARAM = "scene";
var GIST_PARAM = "gist";
var FILE_PARAM = "file";
var GIST_ID = /^[A-Za-z0-9]+$/;
var WEB_PROTOCOLS = ["http:", "https:"];
var SourceError = class extends Error {
};
function parseSources(search, base) {
  const query = new URLSearchParams(search);
  const urls = query.getAll(SCENE_PARAM);
  const gist = query.get(GIST_PARAM);
  if (gist !== null && urls.length > 0) throw new SourceError("Give scene= or gist=, not both.");
  if (gist !== null) {
    if (!GIST_ID.test(gist)) throw new SourceError(`gist= should be a gist id (letters and digits), got "${gist}".`);
    return [{ kind: "gist", id: gist, file: query.get(FILE_PARAM) || null }];
  }
  return urls.map((value) => ({ kind: "url", url: resolveWebUrl(value, base), byDefault: false }));
}
function resolveWebUrl(value, base) {
  if (value.trim() === "") throw new SourceError("scene= needs a URL.");
  let url;
  try {
    url = new URL(value.trim(), base);
  } catch {
    throw new SourceError(`"${value}" is not a URL.`);
  }
  if (!WEB_PROTOCOLS.includes(url.protocol))
    throw new SourceError(`Only http and https scene URLs can be opened, not "${value}".`);
  return url.href;
}
function pathSegments(url) {
  return new URL(url).pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}
function sourcesToOpen(search, base, defaults) {
  const sources = parseSources(search, base);
  if (sources.length > 0) return sources;
  return defaults.map((scene2) => ({ kind: "url", url: resolveWebUrl(scene2, base), byDefault: true }));
}
function nameOf(source) {
  switch (source.kind) {
    case "embedded":
    case "live":
      return source.page.name;
    case "file":
      return source.file.name;
    case "url":
    case "gist":
      return sceneName(source);
  }
}
function fromOf(source) {
  switch (source.kind) {
    case "embedded":
    case "live":
      return source.page.from;
    case "file":
      return "local file";
    case "url":
      return source.url;
    case "gist":
      return `gist ${source.id}`;
  }
}
function linkOf(source, pageHref) {
  const query = queryOf(source);
  if (query === null) return null;
  const link = new URL(pageHref);
  link.hash = "";
  link.search = query;
  return link.href;
}
function queryOf(source) {
  switch (source.kind) {
    case "embedded":
    case "file":
      return null;
    case "live":
      return "";
    case "url":
      return source.byDefault ? "" : new URLSearchParams({ [SCENE_PARAM]: source.url }).toString();
    case "gist":
      return new URLSearchParams({
        [GIST_PARAM]: source.id,
        ...source.file === null ? {} : { [FILE_PARAM]: source.file }
      }).toString();
  }
}
function sceneName(source) {
  if (source.kind === "gist") return source.file ?? `gist ${source.id}`;
  const segments = pathSegments(source.url);
  const stem = (segments.at(-1) ?? source.url).replace(SCENE_FILE, "");
  return stem === "scene" ? segments.at(-2) ?? stem : stem;
}

// src/scene/fetch.ts
var GIST_API = "https://api.github.com/gists/";
var GIST_ACCEPT = "application/vnd.github+json";
async function get(url, accept) {
  let response;
  try {
    response = await fetch(url, { headers: accept ? { Accept: accept } : {}, referrerPolicy: "no-referrer" });
  } catch {
    throw new SceneError(
      `Could not fetch ${url}: the network failed, or the server does not allow this page to read it (CORS).`
    );
  }
  if (!response.ok) {
    const status = [response.status, response.statusText].filter(Boolean).join(" ");
    throw new SceneError(`The server answered ${status} for ${url}.`);
  }
  return response;
}
async function fetchScene(url) {
  const response = await get(url);
  if (!response.body) throw new SceneError(`${url} sent no data.`);
  return sceneFromBytes(await readCapped(response.body, `The scene at ${url}`));
}
async function fetchServedVersion() {
  const response = await fetch("status", { cache: "no-store" });
  if (!response.ok) throw new SceneError(`The server answered ${response.status} for status.`);
  return (await response.json()).version ?? null;
}
async function fetchLive() {
  const response = await fetch("scene.json", { cache: "no-store" });
  if (!response.ok) throw new SceneError(`The server answered ${response.status} for scene.json.`);
  return response.json();
}
async function fetchGist(id, file) {
  const response = await get(GIST_API + encodeURIComponent(id), GIST_ACCEPT);
  let gist;
  try {
    gist = await response.json();
  } catch {
    throw new SceneError(`GitHub sent no gist data for ${id}.`);
  }
  const picked = pickGistFile(gist.files ?? {}, file);
  const raw = resolveWebUrl(picked.raw_url, GIST_API);
  return { name: picked.filename, doc: await fetchScene(raw) };
}

// src/camera/viewhash.ts
import { MathUtils as MathUtils4 } from "three";
var VIEW_KEY = "view";
var SIGNIFICANT_DIGITS = 4;
var FIELD_SEPARATOR = ";";
var VECTOR_SEPARATOR = ",";
var VECTOR_LENGTH = 3;
var numberText = (x2) => String(Number(x2.toPrecision(SIGNIFICANT_DIGITS)));
var vectorText = (v2) => v2.map(numberText).join(VECTOR_SEPARATOR);
function encodeView(pose) {
  const size = pose.projection === "persp" ? `lens=${numberText(pose.lens)}` : `zoom=${numberText(pose.zoom)}`;
  return [
    pose.projection,
    size,
    `eye=${vectorText(pose.eye)}`,
    `at=${vectorText(pose.at)}`,
    `up=${vectorText(pose.up)}`
  ].join(FIELD_SEPARATOR);
}
function decodeView(text) {
  const [projection2, ...rest] = text.split(FIELD_SEPARATOR);
  if (projection2 !== "persp" && projection2 !== "ortho") return null;
  const fields = new URLSearchParams(rest.join("&"));
  const vector = (name) => {
    const parts = (fields.get(name) ?? "").split(VECTOR_SEPARATOR).map(Number);
    return parts.length === VECTOR_LENGTH && parts.every(Number.isFinite) ? parts : null;
  };
  const size = Number(fields.get(projection2 === "persp" ? "lens" : "zoom"));
  const eye = vector("eye"), at = vector("at"), up = vector("up");
  if (!(size > 0) || !Number.isFinite(size) || !eye || !at || !up) return null;
  return {
    projection: projection2,
    lens: projection2 === "persp" ? size : 0,
    zoom: projection2 === "ortho" ? size : 1,
    eye,
    at,
    up
  };
}
function viewFromPose(pose, extent2, lens2) {
  const numbers = [...pose.eye, ...pose.at, ...pose.up, pose.zoom];
  if (!numbers.every(Number.isFinite)) return null;
  const separation = span(pose.eye, pose.at);
  if (separation === 0 || Math.hypot(...pose.up) === 0) return null;
  const persp = pose.projection === "persp";
  const zoom2 = persp ? MathUtils4.clamp(baseDistance(extent2) / separation, ZOOM_MIN, ZOOM_MAX) : pose.zoom;
  return {
    target: [...pose.at],
    orientation: orientationFromBasis(vsub(pose.eye, pose.at), pose.up),
    zoom: zoom2,
    projection: pose.projection,
    lens: persp ? pose.lens : lens2
  };
}
function poseOf(view2, extent2) {
  return {
    projection: view2.projection,
    lens: view2.lens,
    zoom: view2.zoom,
    eye: cameraPosition(view2, extent2),
    at: view2.target,
    up: upAxis(view2.orientation)
  };
}

// src/ui/toast.ts
var DEFAULT_MS = 6e3;
var FADE_MS = 400;
var STAY = "stay";
var toast = byId("toast");
var timer;
function note(text, ms = DEFAULT_MS) {
  clearTimeout(timer);
  toast.textContent = text;
  toast.hidden = false;
  toast.classList.remove("fade");
  if (ms === STAY) return;
  timer = setTimeout(() => {
    toast.classList.add("fade");
    timer = setTimeout(hideNote, FADE_MS);
  }, ms);
}
function hideNote() {
  clearTimeout(timer);
  toast.hidden = true;
}
var noteText = () => toast.textContent ?? "";

// src/ui/views.ts
import * as THREE7 from "three";
function viewDirection(azimuthDeg, elevationDeg) {
  const a2 = THREE7.MathUtils.degToRad(azimuthDeg), e3 = THREE7.MathUtils.degToRad(elevationDeg);
  return new THREE7.Vector3(Math.cos(e3) * Math.cos(a2), Math.cos(e3) * Math.sin(a2), Math.sin(e3));
}
var VIEWS = {
  a: () => viewFrom(loaded.value.lattice[0], loaded.value.lattice[2]),
  b: () => viewFrom(loaded.value.lattice[1], loaded.value.lattice[2]),
  c: () => viewFrom(loaded.value.lattice[2], loaded.value.lattice[1]),
  rotated: () => viewFrom(viewDirection(LOOK.azimuth, LOOK.elevation), new THREE7.Vector3(0, 0, 1))
};
function wireViewButtons() {
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => VIEWS[button.dataset.view ?? ""]());
  }
}

// src/ui/share.ts
var SETTLE_MS = 200;
var NOTE_MS = 5e3;
var currentPose = () => poseOf(viewNow(), loaded.value.extent);
function applyPose(pose) {
  const next = viewFromPose(pose, loaded.value.extent, lens.value);
  if (!next) {
    VIEWS.rotated();
    return;
  }
  setView(next);
  writeAddress(encodeView(currentPose()));
}
var pending = readAddressPose();
function readAddressPose() {
  const text = new URLSearchParams(location.hash.slice(1)).get(VIEW_KEY);
  return text === null ? null : decodeView(text);
}
function takePendingPose() {
  const pose = pending;
  pending = null;
  return pose;
}
function writeAddress(text) {
  const url = new URL(location.href);
  url.hash = `${VIEW_KEY}=${text}`;
  history.replaceState(history.state, "", url.href);
}
var watching = false;
function watchView() {
  if (watching) return;
  watching = true;
  let written = encodeView(currentPose());
  let previous = written;
  setInterval(() => {
    const now = encodeView(currentPose());
    if (now === previous && now !== written) {
      written = now;
      writeAddress(now);
    }
    previous = now;
  }, SETTLE_MS);
}
var sceneLink = null;
function setSceneLink(link) {
  sceneLink = link;
}
function copyLink() {
  const url = new URL(sceneLink ?? location.href);
  url.hash = `${VIEW_KEY}=${encodeView(currentPose())}`;
  const said = sceneLink === null ? "Copied the view only: an embedded or local scene cannot go in a link, so the link opens this page at this view." : "Copied the link: this scene, at this view.";
  const refused = () => note("Could not copy the link: the browser refused the clipboard.", NOTE_MS);
  try {
    navigator.clipboard.writeText(url.href).then(() => note(said, NOTE_MS), refused);
  } catch {
    refused();
  }
}
byId("copy-link").addEventListener("click", copyLink);

// src/ui/outline-scale.ts
var OUTLINE_SCALE_KEY = "gemmy.outline-scale";
var OUTLINE_SCALE_CHOICES = [0.5, 1, 1.75];
var DEFAULT_SCALE = 1;
function isOutlineScale(value) {
  return OUTLINE_SCALE_CHOICES.some((choice) => choice === value);
}
var stored = remembered(OUTLINE_SCALE_KEY, (raw) => {
  const value = Number(raw);
  return isOutlineScale(value) ? value : DEFAULT_SCALE;
});
var outlineScale = y(stored.read());
x(() => setOutlineScale(outlineScale.value));
function chooseOutlineScale(scale) {
  outlineScale.value = scale;
  stored.write(scale);
}
var outlineSegments = [...document.querySelectorAll("[data-outline-scale]")];
for (const segment of outlineSegments) {
  segment.addEventListener("click", () => chooseOutlineScale(Number(segment.dataset.outlineScale)));
}
x(() => {
  for (const segment of outlineSegments) {
    segment.setAttribute("aria-pressed", String(Number(segment.dataset.outlineScale) === outlineScale.value));
  }
});

// src/ui/theme.ts
var THEME_KEY = "gemmy.theme";
var THEME_CHOICES = ["auto", "light", "dark"];
var AUTO = "auto";
var THEME_ATTRIBUTE = "data-theme";
var DARK_QUERY = "(prefers-color-scheme: dark)";
function isThemeChoice(value) {
  return THEME_CHOICES.some((choice) => choice === value);
}
function applyToPage(choice) {
  if (choice === AUTO) document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  else document.documentElement.setAttribute(THEME_ATTRIBUTE, choice);
}
var stored2 = remembered(THEME_KEY, (raw) => isThemeChoice(raw) ? raw : AUTO);
var theme = y(stored2.read());
applyToPage(theme.peek());
var systemQuery = matchMedia(DARK_QUERY);
var systemDark = y(systemQuery.matches);
systemQuery.addEventListener("change", (event) => {
  systemDark.value = event.matches;
});
function setTheme(choice) {
  applyToPage(choice);
  stored2.write(choice);
  theme.value = choice;
}
function cycleTheme() {
  const next = (THEME_CHOICES.indexOf(theme.peek()) + 1) % THEME_CHOICES.length;
  setTheme(THEME_CHOICES[next]);
}
var themeSegments = [...document.querySelectorAll("[data-theme-choice]")];
for (const segment of themeSegments) {
  segment.addEventListener("click", () => {
    const choice = segment.dataset.themeChoice;
    if (isThemeChoice(choice)) setTheme(choice);
  });
}
x(() => {
  for (const segment of themeSegments) {
    segment.setAttribute("aria-pressed", String(segment.dataset.themeChoice === theme.value));
  }
});

// src/render/triad3d.ts
import * as THREE9 from "three";

// src/render/triad-model.ts
import * as THREE8 from "three";
var T = GEMMY.triad;
var SHAFT_RADIUS = T.arrowRadius;
var HEAD_RADIUS = T.headRadiusRatio * T.arrowRadius;
var HEAD_LENGTH = T.headLengthRatio;
var BALL_TO_HEAD_BASE = 1.1;
var BALL_RADIUS = BALL_TO_HEAD_BASE * HEAD_RADIUS;
var BALL_COLOUR = "#ffffff";
var SIDES = 24;
var BALL_SEGMENTS = { width: 32, height: 16 };
var CORNER_LENGTHS = 1.2;
var CAMERA_LENGTHS = 3;
var NEAR_LENGTHS = 0.5;
var FAR_LENGTHS = 5;
var UP2 = new THREE8.Vector3(0, 1, 0);
function triadModel(length2, directions) {
  const shaftLength = length2 * (1 - HEAD_LENGTH / 2);
  const shaft = { kind: "cylinder", radius: SHAFT_RADIUS * length2, height: shaftLength };
  const head = { kind: "cone", radius: HEAD_RADIUS * length2, height: HEAD_LENGTH * length2 };
  const orientation = (direction) => new THREE8.Quaternion().setFromUnitVectors(UP2, direction);
  const shafts = directions.map(
    (direction, axis) => ({
      shape: shaft,
      position: direction.clone().multiplyScalar(shaftLength / 2),
      quaternion: orientation(direction),
      colour: LOOK.axisColors[axis],
      axis
    })
  );
  const heads = directions.map(
    (direction, axis) => ({
      shape: head,
      position: direction.clone().multiplyScalar(length2 - HEAD_LENGTH * length2 / 2),
      quaternion: orientation(direction),
      colour: LOOK.axisColors[axis],
      axis
    })
  );
  const ball = {
    shape: { kind: "sphere", radius: BALL_RADIUS * length2, height: BALL_RADIUS * length2 },
    position: new THREE8.Vector3(),
    quaternion: new THREE8.Quaternion(),
    colour: BALL_COLOUR,
    axis: null
  };
  return [...shafts, ...heads, ball];
}
function shapeGeometry(shape) {
  const { radius, height } = shape;
  switch (shape.kind) {
    case "cylinder":
      return new THREE8.CylinderGeometry(radius, radius, height, SIDES, 1);
    case "cone":
      return new THREE8.ConeGeometry(radius, height, SIDES, 1);
    case "sphere":
      return new THREE8.SphereGeometry(radius, BALL_SEGMENTS.width, BALL_SEGMENTS.height);
  }
}
function partMatrix(part) {
  const { kind, radius, height } = part.shape;
  const scale = new THREE8.Vector3(radius, kind === "sphere" ? radius : height, radius);
  return new THREE8.Matrix4().compose(part.position, part.quaternion, scale).toArray();
}
function triadCorner(layout, width, height) {
  const [originX, originDownY] = layout.origin;
  const originY = height - originDownY;
  return {
    originX,
    originY,
    width: Math.min(width, originX + CORNER_LENGTHS * layout.length),
    height: Math.min(height, originY + CORNER_LENGTHS * layout.length)
  };
}
function placeTriadCamera(camera2, orientation, corner, length2) {
  const forward = new THREE8.Vector3(0, 0, -1).applyQuaternion(orientation);
  camera2.quaternion.copy(orientation);
  camera2.position.copy(forward).multiplyScalar(-CAMERA_LENGTHS * length2);
  Object.assign(camera2, {
    left: -corner.originX,
    right: corner.width - corner.originX,
    bottom: -corner.originY,
    top: corner.height - corner.originY,
    near: NEAR_LENGTHS * length2,
    far: FAR_LENGTHS * length2
  });
  camera2.updateProjectionMatrix();
}

// src/render/triad3d.ts
var triadScene = new THREE9.Scene();
var triadCamera = new THREE9.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
triadScene.add(triadCamera);
addToonLights(triadScene, triadCamera);
var SOLID_COUNT = 2 * LOOK.axisColors.length + 1;
var solids = Array.from({ length: SOLID_COUNT }, () => {
  const toonMat = toonMaterial();
  const shell = outlineShell();
  return { toon: toonMat, shell, mesh: new THREE9.Mesh(void 0, toonMat), outline: new THREE9.Mesh(void 0, shell) };
});
for (const solid of solids) {
  for (const mesh of [solid.mesh, solid.outline]) {
    mesh.frustumCulled = false;
    triadScene.add(mesh);
  }
}
var builtLength = 0;
function renderTriad(transparent = false) {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const layout = triadLayout(latticeInView(loaded.value.lattice, camera.value.quaternion), width, height);
  const corner = triadCorner(layout, width, height);
  const parts = triadModel(layout.length, loaded.value.lattice);
  ensureGeometry(parts, layout.length);
  placeTriadCamera(triadCamera, camera.value.quaternion, corner, layout.length);
  const background = transparent ? null : new THREE9.Color(cssVar("--bg").trim());
  paintSolids(parts, layout.items, background);
  placeSolids(parts);
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setViewport(0, 0, corner.width, corner.height);
  renderer.setScissor(0, 0, corner.width, corner.height);
  renderer.setScissorTest(true);
  renderer.clearDepth();
  renderer.render(triadScene, triadCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
  renderer.autoClear = autoClear;
}
function paintSolids(parts, items, background) {
  parts.forEach((part, index) => {
    const fade = part.axis === null ? 0 : items.find((item) => item.index === part.axis)?.fade ?? 0;
    const { toon: material, shell } = solids[index];
    const base = new THREE9.Color(part.colour);
    const outlineBase = new THREE9.Color().fromArray(LOOK.outline);
    material.color.copy(background === null ? base : base.lerp(background, fade));
    shell.uniforms.outlineColor.value.copy(background === null ? outlineBase : outlineBase.lerp(background, fade));
    material.opacity = background === null ? 1 - fade : 1;
    shell.uniforms.opacity.value = material.opacity;
    shell.uniforms.outlineScale.value = outlineMaterial.uniforms.outlineScale.value;
  });
  for (const { outline } of solids) outline.visible = outlines.value;
}
function ensureGeometry(parts, length2) {
  if (length2 === builtLength) return;
  builtLength = length2;
  parts.forEach((part, index) => {
    const geometry = shapeGeometry(part.shape);
    for (const mesh of [solids[index].mesh, solids[index].outline]) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
  });
}
function placeSolids(parts) {
  parts.forEach((part, index) => {
    for (const mesh of [solids[index].mesh, solids[index].outline]) {
      mesh.position.copy(part.position);
      mesh.quaternion.copy(part.quaternion);
    }
  });
}
function toonMaterial() {
  const material = toon(null, {}).clone();
  material.transparent = true;
  return material;
}
function outlineShell() {
  return new THREE9.ShaderMaterial({
    side: THREE9.BackSide,
    transparent: true,
    uniforms: {
      outlineThickness: { value: OUTLINE_THICKNESS },
      outlineScale: { value: 1 },
      outlineColor: { value: new THREE9.Color().fromArray(LOOK.outline) },
      opacity: { value: 1 }
    },
    vertexShader: OUTLINE_VERTEX_SHADER,
    fragmentShader: `
    uniform vec3 outlineColor;
    uniform float opacity;
    void main() {
      gl_FragColor = vec4(outlineColor, opacity);
      #include <colorspace_fragment>
    }`
  });
}

// src/render/loop.ts
var FIT_PERCENT = 100;
var zoomLevel = document.getElementById("zoom-level");
function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const atFit = Math.abs(shownNow() - fitValue.value) < EPS;
  fitValue.value = fitFor(width, height);
  fitOrthoFrustum(width, height);
  perspCamera.aspect = width / height;
  perspCamera.setFocalLength(lens.value);
  if (atFit) zoomTo(fitValue.value);
  renderer.setSize(width, height);
  controls.handleResize();
  requestRender();
}
function fitOrthoFrustum(width, height) {
  const { halfWidth, halfHeight } = orthoFrame(loaded.value.extent, width, height);
  Object.assign(orthoCamera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
  orthoCamera.updateProjectionMatrix();
}
var PICTURE = [loaded, outlines, outlineScale, showAtoms, showBox, theme, systemDark];
x(() => {
  for (const part of PICTURE) void part.value;
  requestRender();
});
x(() => {
  void [theme.value, systemDark.value];
  boxMaterial.color.set(cssVar("--box").trim());
});
function frame(now = 0) {
  requestAnimationFrame(frame);
  fly(now);
  controls.update();
  readBack();
  if (takeDirty()) drawView();
}
function drawView() {
  syncClip();
  renderer.render(scene, camera.value);
  renderTriad();
  drawLiveTriad();
  showZoom();
}
function showZoom() {
  const percent = Math.round(shownNow() / fitValue.value * FIT_PERCENT);
  const text = Number.isFinite(percent) ? `${percent}%` : "";
  if (zoomLevel.textContent !== text) zoomLevel.textContent = text;
}
controls.addEventListener("change", requestRender);
window.addEventListener("resize", resize);
document.fonts?.ready.then(requestRender);
frame();

// src/scene/bounds.ts
import { Box3 as Box32, Vector3 as Vector38 } from "three";
var MIN_EXTENT = 1;
function sceneBounds(scene2) {
  const positions = new Map(scene2.points.map((p2) => [p2.id, p2.position]));
  const corners = [...positions.values(), ...arrowEnds(scene2, positions)];
  if (corners.length === 0) return { centre: [0, 0, 0], extent: MIN_EXTENT };
  const box = new Box32().setFromPoints(corners.map((p2) => new Vector38(...p2)));
  const centre = box.getCenter(new Vector38());
  return { centre: [centre.x, centre.y, centre.z], extent: Math.max(box.getSize(new Vector38()).length(), MIN_EXTENT) };
}
function arrowEnds(scene2, positions) {
  const ends = [];
  for (const d2 of scene2.primitives.displacements) {
    const atom = positions.get(d2.start_point_id);
    if (atom === void 0) continue;
    const far = atom.map((x2, i2) => x2 + d2.vector[i2]);
    const near = atom.map((x2, i2) => x2 - d2.vector[i2]);
    ends.push(...d2.anchor === "tip" ? [near, atom] : [atom, far]);
  }
  return ends;
}

// src/scene/load.ts
import * as THREE10 from "three";

// src/geom/cell.ts
function cellCorner(cell, n2) {
  const [a2, b2, c2] = cell.vectors;
  return [0, 1, 2].map((d2) => cell.origin[d2] + (n2 & 1) * a2[d2] + (n2 >> 1 & 1) * b2[d2] + (n2 >> 2 & 1) * c2[d2]);
}
function cellEdges(cell) {
  const corners = Array.from({ length: 8 }, (_2, n2) => cellCorner(cell, n2));
  const edges = [];
  for (let n2 = 0; n2 < 8; n2++) {
    for (let axis = 0; axis < 3; axis++) {
      const bit = 1 << axis;
      if (!(n2 & bit)) edges.push([corners[n2], corners[n2 | bit]]);
    }
  }
  return edges;
}

// src/scene/load.ts
var ORTHO_FAR_EXTENTS = 40;
function load(doc, bounds) {
  disposeScene();
  loaded.value = build(doc, bounds);
}
function build(doc, bounds) {
  const extent2 = bounds.extent;
  const centre = bounds.centre;
  frame2(centre, extent2);
  const atomGroup = addAtomsBondsAndArrows(doc);
  const { polyGroup, polyTargets } = addPolyhedra(doc);
  const box = addCellBox(doc.cell);
  return {
    data: doc,
    points: new Map(doc.points.map((p2) => [p2.id, p2])),
    polyhedra: doc.primitives.polyhedra,
    centre,
    extent: extent2,
    // A scene without a cell keeps the lattice of the scene before it.
    lattice: doc.cell ? latticeOf(doc.cell) : loaded.peek().lattice,
    atomGroup,
    polyGroup,
    box,
    polyTargets
  };
}
function frame2(centre, extent2) {
  root.position.set(-centre[0], -centre[1], -centre[2]);
  orthoCamera.far = extent2 * ORTHO_FAR_EXTENTS;
  controls.minDistance = baseDistance(extent2) / ZOOM_MAX;
  controls.maxDistance = baseDistance(extent2) / ZOOM_MIN;
}
function latticeOf(cell) {
  return cell.vectors.map((vec) => new THREE10.Vector3(...vec).normalize());
}
function addAtomsBondsAndArrows(doc) {
  const atomGroup = new THREE10.Group();
  const bondGroup = new THREE10.Group();
  const shapes = /* @__PURE__ */ new Map();
  for (const g2 of instanceGroups(doc)) {
    const shapeName = g2.shape;
    let shape = shapes.get(shapeName);
    if (!shape) {
      shape = SHAPES[shapeName]();
      shapes.set(shapeName, shape);
    }
    const mesh = instanced(shape, toon(g2.material, doc.materials), g2.matrices);
    const isAtom = g2.shape === "sphere";
    const owner = isAtom ? atomGroup : bondGroup;
    owner.add(mesh);
    if (isAtom) mesh.userData = { atoms: g2.refs };
    if (g2.outlined) owner.add(outlineOf(mesh));
  }
  root.add(atomGroup, bondGroup);
  return atomGroup;
}
function addPolyhedra(doc) {
  const polyGroup = new THREE10.Group();
  const polyTargets = new Array(doc.primitives.polyhedra.length);
  for (const g2 of polyhedronGroups(doc)) {
    const ghost = isGhost(doc.materials[g2.material]);
    const geometry = new THREE10.BufferGeometry();
    geometry.setAttribute("position", new THREE10.Float32BufferAttribute(g2.positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE10.Mesh(geometry, toon(g2.material, doc.materials, { faces: true, ghost }));
    mesh.userData = { owner: g2.owner };
    if (ghost) mesh.renderOrder = 1;
    for (const [index, first, count2] of g2.ranges) {
      polyTargets[index] = { kind: "polyhedron", poly: doc.primitives.polyhedra[index], ghost, mesh, first, count: count2 };
    }
    const edgeGeometry = new THREE10.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE10.Float32BufferAttribute(g2.edges, 3));
    polyGroup.add(mesh, new THREE10.LineSegments(edgeGeometry, edgeMaterial));
    if (!ghost) polyGroup.add(outlineOf(mesh));
  }
  root.add(polyGroup);
  return { polyGroup, polyTargets };
}
function addCellBox(cell) {
  if (!cell) return null;
  const boxGeometry = new THREE10.BufferGeometry();
  boxGeometry.setAttribute("position", new THREE10.Float32BufferAttribute(cellEdges(cell).flat(2), 3));
  const cellBox = new THREE10.LineSegments(boxGeometry, boxMaterial);
  root.add(cellBox);
  return cellBox;
}

// src/ui/stage.ts
var DRAG_FEEL = { rotateSpeed: 3, zoomSpeed: 1.2, panSpeed: 0.8, staticMoving: true };
function place(doc) {
  select(null);
  r(() => {
    load(doc, sceneBounds(doc));
    resize();
  });
}
function openScene(doc, view2) {
  place(doc);
  if (view2) applyPose(view2);
  else VIEWS.rotated();
  const { centre, points, polyTargets } = loaded.value;
  const middle = [...polyTargets].sort(
    (p2, q) => dist(points.get(p2.poly.center_point_id).position, centre) - dist(points.get(q.poly.center_point_id).position, centre)
  )[0];
  select(middle ?? null);
  showInfo(infoChoice() ?? (Boolean(middle) && !narrowScreen.matches));
  watchView();
}
function updateScene(doc) {
  place(doc);
}
function wireShowToggle(id, flag) {
  const button = byId(id);
  button.addEventListener("click", () => {
    flag.value = !flag.value;
  });
  x(() => button.setAttribute("aria-pressed", String(flag.value)));
}
function wireStage() {
  Object.assign(controls, DRAG_FEEL);
  wireShowToggle("toggle-atoms", showAtoms);
  wireShowToggle("toggle-outline", outlines);
  wireShowToggle("toggle-box", showBox);
  x(() => {
    loaded.value.atomGroup.visible = showAtoms.value;
  });
  x(() => {
    outlineMaterial.visible = outlines.value;
  });
  x(() => {
    const { box } = loaded.value;
    if (box) box.visible = showBox.value;
  });
}

// src/ui/overflow.ts
var EDGE_SLACK_PX = 2;
var watched = /* @__PURE__ */ new Set();
function markOverflow(el) {
  const { scrollLeft, scrollWidth, clientWidth } = el;
  el.classList.toggle("more-left", scrollLeft > EDGE_SLACK_PX);
  el.classList.toggle("more-right", scrollLeft + clientWidth < scrollWidth - EDGE_SLACK_PX);
}
function watchOverflow(el) {
  if (!watched.has(el)) {
    watched.add(el);
    el.addEventListener("scroll", () => markOverflow(el), { passive: true });
  }
  markOverflow(el);
}
window.addEventListener("resize", () => watched.forEach(markOverflow));

// src/ui/tab-bar.ts
function makeBar(onOwnLink) {
  const built = document.querySelector(".tabs");
  if (built) {
    const ownLink = built.querySelector('a[aria-current="page"]');
    ownLink?.addEventListener("click", (event) => {
      event.preventDefault();
      onOwnLink();
    });
    return { element: built, ownLink };
  }
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.setAttribute("aria-label", "Scenes");
  byId("menu-island").insertBefore(nav, document.querySelector(".name"));
  return { element: nav, ownLink: null };
}
function renderTabs(bar, entries, current, actions) {
  const strip = bar.element;
  strip.querySelectorAll(".local-tab").forEach((element) => {
    element.remove();
  });
  entries.forEach((entry, k) => {
    if (k !== 0 || bar.ownLink === null) strip.appendChild(tabElement(entry, k === current, k, actions));
  });
  if (bar.ownLink !== null) {
    if (current === 0) bar.ownLink.setAttribute("aria-current", "page");
    else bar.ownLink.removeAttribute("aria-current");
  }
  watchOverflow(strip);
  strip.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function tabElement(entry, isCurrent, k, actions) {
  const wrap = document.createElement("span");
  wrap.className = "local-tab";
  const choice = document.createElement("button");
  choice.type = "button";
  choice.textContent = entry.label;
  if (isCurrent) choice.setAttribute("aria-current", "page");
  choice.addEventListener("click", () => actions.choose(k));
  wrap.appendChild(choice);
  if (entry.closable) wrap.appendChild(closeButton(entry.label, () => actions.close(k)));
  return wrap;
}
function closeButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab-close";
  button.title = `Close ${label}`;
  button.setAttribute("aria-label", `Close ${label}`);
  button.append(cloneTemplate("close-icon"));
  button.addEventListener("click", onClick);
  return button;
}

// src/ui/tab-model.ts
function tabsOf(tabs, current = 0) {
  return { tabs, current };
}
function addTab(list, tab) {
  return { tabs: [...list.tabs, tab], current: list.tabs.length };
}
function chooseTab(list, k) {
  return k >= 0 && k < list.tabs.length ? { tabs: list.tabs, current: k } : list;
}
function closeTab(list, k) {
  if (list.tabs.length < 2 || k < 0 || k >= list.tabs.length) return list;
  const tabs = list.tabs.filter((_2, j2) => j2 !== k);
  if (k === list.current) return { tabs, current: Math.max(0, k - 1) };
  return { tabs, current: k < list.current ? list.current - 1 : list.current };
}
function uniqueLabel(label, taken) {
  if (!taken.includes(label)) return label;
  let n2 = 2;
  while (taken.includes(`${label} (${n2})`)) n2 += 1;
  return `${label} (${n2})`;
}

// src/ui/loader.ts
var PROGRESS_MS = 150;
var empty = byId("empty");
var emptyStatus = byId("empty-status");
var emptyError = byId("empty-error");
var urlForm = byId("empty-url");
var urlInput = byId("scene-url");
var fileInput = byId("scene-file");
var closeButton2 = byId("empty-close");
var messageOf2 = (error) => error instanceof Error ? error.message : String(error);
var state = {
  tabs: tabsOf([]),
  bar: null,
  shown: null,
  servedVersion: null,
  liveTurn: Promise.resolve(),
  tabListeners: []
};
function inLiveTurn(task) {
  const result = state.liveTurn.then(task);
  state.liveTurn = result.then(
    () => void 0,
    () => void 0
  );
  return result;
}
function onTabChange(listener) {
  state.tabListeners.push(listener);
}
function showCard() {
  empty.hidden = false;
  closeButton2.hidden = !hasScene();
  document.body.classList.add("no-scene");
}
function hideCard() {
  empty.hidden = true;
  emptyStatus.textContent = "";
  emptyError.hidden = true;
  document.body.classList.remove("no-scene");
}
function busy(text) {
  showCard();
  emptyError.hidden = true;
  emptyStatus.textContent = text;
}
function fail(text) {
  showCard();
  emptyStatus.textContent = "";
  emptyError.textContent = text;
  emptyError.hidden = false;
}
async function loadSource(source) {
  switch (source.kind) {
    case "embedded":
      return { doc: source.doc, name: nameOf(source) };
    case "live":
      state.servedVersion = await fetchServedVersion();
      return { doc: await fetchLive(), name: nameOf(source) };
    case "url":
      return { doc: await fetchScene(source.url), name: nameOf(source) };
    case "gist": {
      const { name, doc } = await fetchGist(source.id, source.file);
      return { doc, name };
    }
    case "file":
      return { doc: await sceneFromFile(source.file), name: nameOf(source) };
  }
}
function loadTab(tab) {
  if (tab.source.kind === "live") return inLiveTurn(() => loadSource(tab.source));
  tab.loaded ??= loadSource(tab.source).catch((error) => {
    tab.loaded = null;
    throw error;
  });
  return tab.loaded;
}
var currentTab = () => state.tabs.tabs[state.tabs.current];
async function showCurrent() {
  const tab = currentTab();
  if (!tab) return;
  for (const listener of state.tabListeners) listener(tab.source);
  const progress = setTimeout(() => {
    if (tab === currentTab()) busy(`Loading ${nameOf(tab.source)}\u2026`);
  }, PROGRESS_MS);
  try {
    const loaded2 = await loadTab(tab);
    clearTimeout(progress);
    if (tab !== currentTab()) return;
    openScene(loaded2.doc, takePendingPose());
    state.shown = tab;
    setSceneLink(linkOf(tab.source, location.href));
    pageName.show(loaded2.name, fromOf(tab.source));
    document.title = `gemmy: ${loaded2.name}`;
    hideCard();
  } catch (error) {
    clearTimeout(progress);
    if (tab === currentTab()) fail(`Could not load ${nameOf(tab.source)}: ${messageOf2(error)}`);
  }
}
function reloadLive(version) {
  return inLiveTurn(async () => {
    const tab = currentTab();
    if (!version || tab?.source.kind !== "live" || version === state.servedVersion) return;
    if (tab !== state.shown) {
      void showCurrent();
      return;
    }
    const loaded2 = await loadSource(tab.source);
    if (tab === currentTab()) updateScene(loaded2.doc);
  });
}
function choose(k) {
  state.tabs = chooseTab(state.tabs, k);
  renderBar();
  return showCurrent();
}
function closeAt(k) {
  const wasCurrent = k === state.tabs.current;
  state.tabs = closeTab(state.tabs, k);
  renderBar();
  return wasCurrent ? showCurrent() : Promise.resolve();
}
function renderBar() {
  if (state.bar === null) return;
  const many = state.tabs.tabs.length > 1;
  renderTabs(
    state.bar,
    state.tabs.tabs.map((tab) => ({ label: tab.label, closable: many && tab.source.kind === "file" })),
    state.tabs.current,
    { choose: (k) => void choose(k), close: (k) => void closeAt(k) }
  );
}
function ensureBar() {
  state.bar ??= makeBar(() => {
    if (state.tabs.current !== 0) void choose(0);
  });
}
function addSources(sources) {
  for (const source of sources) {
    const label = uniqueLabel(
      nameOf(source),
      state.tabs.tabs.map((tab) => tab.label)
    );
    state.tabs = addTab(state.tabs, { label, source, loaded: null });
  }
}
function addFiles(files) {
  if (files.length === 0) return;
  ensureBar();
  addSources(files.map((file) => ({ kind: "file", file })));
  void choose(state.tabs.tabs.length - 1);
}
function startTabs(read) {
  let sources;
  try {
    sources = read();
  } catch (error) {
    fail(messageOf2(error));
    return;
  }
  if (sources.length === 0) {
    showCard();
    return;
  }
  state.tabs = tabsOf([]);
  addSources(sources);
  if (state.tabs.tabs.length > 1) ensureBar();
  void choose(0);
}
function showUrlForm() {
  showCard();
  urlInput.focus();
}
function closeUrlForm() {
  if (empty.hidden || !hasScene()) return false;
  hideCard();
  return true;
}
function attachOpeners() {
  closeButton2.addEventListener("click", () => closeUrlForm());
  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) document.body.classList.remove("dragging");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("dragging");
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = "";
    addFiles(files);
  });
  byId("open-scene").addEventListener("click", () => fileInput.click());
  byId("empty-open").addEventListener("click", () => fileInput.click());
  urlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const url = resolveWebUrl(urlInput.value, location.href);
      location.search = new URLSearchParams({ scene: url }).toString();
    } catch (error) {
      fail(messageOf2(error));
    }
  });
}

// src/trace/traced.ts
import * as THREE16 from "three";

// src/export/markup.ts
import { Color as Color4, LinearSRGBColorSpace, SRGBColorSpace as SRGBColorSpace2 } from "three";
var SVG_PRECISION = 100;
var fmt = (x2) => Number.isFinite(x2) ? String(Math.round(x2 * SVG_PRECISION) / SVG_PRECISION || 0) : "0";
var fmtPt = (p2) => `${fmt(p2[0])} ${fmt(p2[1])}`;
function srgbHex(rgb) {
  return `#${new Color4().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace2).getHexString()}`;
}
function linearHex(rgb) {
  return `#${new Color4().setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace).getHexString()}`;
}
function shadedBand(base, darkening) {
  return `#${new Color4().setRGB(base[0], base[1], base[2], SRGBColorSpace2).multiplyScalar(darkening).getHexString()}`;
}

// src/export/svg-dom.ts
var SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === void 0 || value === false) continue;
    node.setAttribute(name, typeof value === "number" ? fmt(value) : value);
  }
  node.append(...children.filter((child) => child !== null));
  return node;
}

// src/export/view.ts
import { Quaternion as Quaternion5, Vector2 as Vector22, Vector3 as Vector310 } from "three";
var MIN_DEPTH = 1e-3;
var HORIZON_MARGIN = 1e-3;
var vec3 = (p2) => new Vector310(p2[0], p2[1], p2[2]);
function makeView(o2) {
  const { width: W, height: H, zoom: zoom2 } = o2;
  const orientation = new Quaternion5().fromArray(o2.quaternion);
  const right = new Vector310(1, 0, 0).applyQuaternion(orientation);
  const up = new Vector310(0, 1, 0).applyQuaternion(orientation);
  const back = new Vector310(0, 0, 1).applyQuaternion(orientation);
  const offset = vec3(o2.centre).add(vec3(o2.target));
  const inverse = orientation.clone().invert();
  const persp = o2.projection === "persp";
  const lens2 = o2.lens ?? GEMMY.defaultLens;
  const eyeZ = baseDistance(o2.extent) / zoom2;
  const focal = lens2 * (Math.max(W, H) / GEMMY.sensorWidth);
  const scale = W / (2 * orthoFrame(o2.extent, W, H).halfWidth) * zoom2;
  const pinhole = { eyeZ, focal, W, H };
  const toCam = (p2) => p2.clone().sub(offset).applyQuaternion(inverse);
  const pxPerUnit = (c2) => persp ? focal / Math.max(eyeZ - c2.z, MIN_DEPTH) : scale;
  const toScreen = (c2) => {
    const k = pxPerUnit(c2);
    return new Vector22(W / 2 + c2.x * k, H / 2 - c2.y * k);
  };
  const depth = (c2) => persp ? -Math.hypot(c2.x, c2.y, eyeZ - c2.z) : c2.z;
  const sphereImage = (c2, r2) => {
    if (!persp) {
      const s2 = toScreen(c2);
      return { cx: s2.x, cy: s2.y, rx: r2 * scale, ry: r2 * scale, phi: 0 };
    }
    return perspectiveSphereImage(c2, r2, pinhole);
  };
  return { right, up, back, toCam, toScreen, depth, pxPerUnit, sphereImage };
}
function viewOfCorner(orientation, origin) {
  const inverse = orientation.clone().invert();
  const axis = (x2, y2, z) => new Vector310(x2, y2, z).applyQuaternion(orientation);
  const toCam = (p2) => p2.clone().applyQuaternion(inverse);
  const toScreen = (c2) => new Vector22(origin[0] + c2.x, origin[1] - c2.y);
  return {
    right: axis(1, 0, 0),
    up: axis(0, 1, 0),
    back: axis(0, 0, 1),
    toCam,
    toScreen,
    depth: (c2) => c2.z,
    pxPerUnit: () => 1,
    // the triad's lengths are CSS px
    sphereImage: (c2, r2) => {
      const s2 = toScreen(c2);
      return { cx: s2.x, cy: s2.y, rx: r2, ry: r2, phi: 0 };
    }
  };
}
function perspectiveSphereImage(c2, r2, pinhole) {
  const { eyeZ, focal, W, H } = pinhole;
  const t2 = eyeZ - c2.z;
  const rho = Math.hypot(c2.x, c2.y);
  const dist2 = Math.hypot(rho, t2);
  const theta = Math.atan2(rho, t2);
  const alpha = Math.asin(Math.min(r2 / dist2, 1));
  if (dist2 <= r2 || theta + alpha >= Math.PI / 2 - HORIZON_MARGIN) return null;
  const nearEdgePx = focal * Math.tan(theta - alpha);
  const farEdgePx = focal * Math.tan(theta + alpha);
  const centreOffsetPx = (nearEdgePx + farEdgePx) / 2;
  const across = (centreOffsetPx * Math.sin(theta) + focal * Math.cos(theta)) / Math.cos(alpha);
  const dx = rho > EPS ? c2.x / rho : 1;
  const dy = rho > EPS ? -c2.y / rho : 0;
  return {
    cx: W / 2 + dx * centreOffsetPx,
    cy: H / 2 + dy * centreOffsetPx,
    rx: (farEdgePx - nearEdgePx) / 2,
    ry: Math.sqrt(Math.max(across * across - centreOffsetPx * centreOffsetPx - focal * focal, 0)),
    phi: Math.atan2(dy, dx)
  };
}

// src/trace/curves.ts
var import_fit_curve = __toESM(require_fit_curve());
import { MathUtils as MathUtils6 } from "three";
var RESAMPLE_PX = 0.25;
var CORNER_ANGLE_DEG = 50;
var CORNER_WINDOW_PX = 1;
var WINDOW_SAMPLES = Math.max(1, Math.round(CORNER_WINDOW_PX / RESAMPLE_PX));
var FIT_ERROR_PX = 0.3;
function segmentsPath(spans) {
  return spans.map(([p2, q]) => `M${fmtPt(p2)}L${fmtPt(q)}`).join("");
}
function closedPath(points) {
  return pathFrom(points, true);
}
function fitCommands(points) {
  return smoothPieces(points, false).map(fitPiece).join("");
}
function pathFrom(points, closed) {
  const pieces = smoothPieces(points, closed);
  if (pieces.length === 0) return "";
  const [x0, y0] = pieces[0][0];
  const d2 = `M${fmt(x0)} ${fmt(y0)}${pieces.map(fitPiece).join("")}`;
  return closed ? `${d2}Z` : d2;
}
function smoothPieces(points, closed) {
  const line = resample(points, closed, RESAMPLE_PX);
  if (line.length < 2) return [];
  const corners = cornerIndices(turningAngles(line, closed), closed);
  return closed ? ringPieces(line, corners) : linePieces(line, corners);
}
function resample(points, closed, spacing) {
  const ring = closed ? [...points, points[0]] : points;
  const lengths = [0];
  for (let i2 = 1; i2 < ring.length; i2++)
    lengths.push(lengths[i2 - 1] + Math.hypot(ring[i2][0] - ring[i2 - 1][0], ring[i2][1] - ring[i2 - 1][1]));
  const total = lengths[lengths.length - 1];
  if (total === 0) return [];
  const count2 = Math.max(2, Math.round(total / spacing));
  const out = [];
  let seg = 0;
  const steps = closed ? count2 : count2 - 1;
  for (let k = 0; k <= steps; k++) {
    const target = k * total / (closed ? count2 : steps);
    while (seg < ring.length - 2 && lengths[seg + 1] < target) seg++;
    const span2 = lengths[seg + 1] - lengths[seg] || 1;
    const t2 = Math.min(1, Math.max(0, (target - lengths[seg]) / span2));
    const a2 = ring[seg];
    const b2 = ring[seg + 1];
    out.push([a2[0] + (b2[0] - a2[0]) * t2, a2[1] + (b2[1] - a2[1]) * t2]);
  }
  return out;
}
function turningAngles(line, closed) {
  const n2 = line.length;
  const step = WINDOW_SAMPLES;
  const turns = new Array(n2).fill(0);
  for (let i2 = 0; i2 < n2; i2++) {
    const before = closed ? (i2 - step + n2) % n2 : i2 - step;
    const after = closed ? (i2 + step) % n2 : i2 + step;
    if (!closed && (before < 0 || after >= n2)) continue;
    const ax = line[i2][0] - line[before][0];
    const ay = line[i2][1] - line[before][1];
    const bx = line[after][0] - line[i2][0];
    const by = line[after][1] - line[i2][1];
    turns[i2] = MathUtils6.radToDeg(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    turns[i2] = Math.abs(turns[i2]);
  }
  return turns;
}
function cornerIndices(turns, closed) {
  const n2 = turns.length;
  const reach = WINDOW_SAMPLES;
  const corners = [];
  for (let i2 = 0; i2 < n2; i2++) {
    if (turns[i2] <= CORNER_ANGLE_DEG) continue;
    let isPeak = true;
    for (let k = -reach; k <= reach && isPeak; k++) {
      if (k === 0) continue;
      const j2 = closed ? (i2 + k + n2) % n2 : i2 + k;
      if (j2 < 0 || j2 >= n2) continue;
      if (turns[j2] > turns[i2] || turns[j2] === turns[i2] && k < 0) isPeak = false;
    }
    if (isPeak) corners.push(i2);
  }
  return corners;
}
function ringPieces(line, corners) {
  const n2 = line.length;
  if (corners.length === 0) return [[...line, line[0]]];
  const pieces = [];
  for (let c2 = 0; c2 < corners.length; c2++) {
    const from = corners[c2];
    const to = corners[(c2 + 1) % corners.length];
    const piece = [];
    for (let i2 = from; ; i2 = (i2 + 1) % n2) {
      piece.push(line[i2]);
      if (i2 === to && piece.length > 1) break;
    }
    pieces.push(piece);
  }
  return pieces;
}
function linePieces(line, corners) {
  const cuts = [0, ...corners.filter((i2) => i2 > 0 && i2 < line.length - 1), line.length - 1];
  const pieces = [];
  for (let c2 = 0; c2 < cuts.length - 1; c2++) pieces.push(line.slice(cuts[c2], cuts[c2 + 1] + 1));
  return pieces;
}
function fitPiece(piece) {
  if (piece.length < 3)
    return piece.slice(1).map((p2) => `L${fmt(p2[0])} ${fmt(p2[1])}`).join("");
  const curves = (0, import_fit_curve.default)(
    piece.map((p2) => [p2[0], p2[1]]),
    FIT_ERROR_PX * FIT_ERROR_PX
  );
  return curves.map(([, c1, c2, end]) => `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(end[0])} ${fmt(end[1])}`).join("");
}

// src/trace/candidates.ts
import * as THREE11 from "three";

// src/trace/ellipse.ts
import { MathUtils as MathUtils7 } from "three";
var MIN_RADIUS_PX = 1e-6;
var QUARTER_TURN = Math.PI / 2;
function arcTo(e3, from, to, pts) {
  const t0 = paramOf(e3, from);
  let prev = t0;
  let swept = 0;
  for (const p2 of pts) {
    const t2 = paramOf(e3, p2);
    swept += wrapPi(t2 - prev);
    prev = t2;
  }
  const dir = swept >= 0 ? 1 : -1;
  return arcSeries(e3, t0, dir, Math.abs(swept), to);
}
function fullEllipseArcs(e3, start) {
  return arcSeries(e3, paramOf(e3, start), 1, 2 * Math.PI, start);
}
function arcSeries(e3, t0, dir, span2, end) {
  const pieces = Math.max(1, Math.ceil(span2 / QUARTER_TURN));
  const sweep = dir > 0 ? 1 : 0;
  let d2 = "";
  for (let k = 1; k <= pieces; k++) {
    const point = k === pieces ? end : pointAt(e3, t0 + dir * span2 * k / pieces);
    d2 += `A${fmt(e3.rx)} ${fmt(e3.ry)} ${fmt(MathUtils7.radToDeg(e3.phi))} 0 ${sweep} ${fmtPt(point)}`;
  }
  return d2;
}
function wrapPi(t2) {
  return t2 - 2 * Math.PI * Math.round(t2 / (2 * Math.PI));
}
function pointAt(e3, t2) {
  const x2 = e3.rx * Math.cos(t2);
  const y2 = e3.ry * Math.sin(t2);
  const cos = Math.cos(e3.phi);
  const sin = Math.sin(e3.phi);
  return [e3.cx + x2 * cos - y2 * sin, e3.cy + x2 * sin + y2 * cos];
}
function paramOf(e3, p2) {
  const [wx, wy] = local(e3, p2);
  return Math.atan2(wy / Math.max(e3.ry, MIN_RADIUS_PX), wx / Math.max(e3.rx, MIN_RADIUS_PX));
}
function local(e3, p2) {
  const dx = p2[0] - e3.cx;
  const dy = p2[1] - e3.cy;
  const cos = Math.cos(e3.phi);
  const sin = Math.sin(e3.phi);
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}
function ellipseRms(e3, pts) {
  const mean = (e3.rx + e3.ry) / 2;
  let sum = 0;
  for (const p2 of pts) {
    const [wx, wy] = local(e3, p2);
    const r2 = Math.hypot(wx / Math.max(e3.rx, MIN_RADIUS_PX), wy / Math.max(e3.ry, MIN_RADIUS_PX));
    sum += ((r2 - 1) * mean) ** 2;
  }
  return Math.sqrt(sum / pts.length);
}
function ellipseFromBasis(c2, a2, b2) {
  const p2 = a2[0] * a2[0] + b2[0] * b2[0];
  const q = a2[0] * a2[1] + b2[0] * b2[1];
  const s2 = a2[1] * a2[1] + b2[1] * b2[1];
  const mean = (p2 + s2) / 2;
  const spread = Math.sqrt(((p2 - s2) / 2) ** 2 + q * q);
  return {
    cx: c2[0],
    cy: c2[1],
    rx: Math.sqrt(mean + spread),
    ry: Math.sqrt(Math.max(mean - spread, 0)),
    phi: 0.5 * Math.atan2(2 * q, p2 - s2)
  };
}

// src/trace/candidates.ts
var SEGMENT_MARGIN_PX = 2;
var MIN_SPAN_PX = 1e-6;
var PARALLEL_COS = 1e-6;
var HALF_AXIS = 0.5;
function curveRms(curve, pts) {
  return curve.kind === "line" ? lineRms(curve.a, curve.b, pts) : ellipseRms(curve.e, pts);
}
function lineRms(a2, b2, pts) {
  const dx = b2[0] - a2[0];
  const dy = b2[1] - a2[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_SPAN_PX) return Infinity;
  let sum = 0;
  for (const p2 of pts) {
    const along = ((p2[0] - a2[0]) * dx + (p2[1] - a2[1]) * dy) / len;
    if (along < -SEGMENT_MARGIN_PX || along > len + SEGMENT_MARGIN_PX) return Infinity;
    const across = ((p2[0] - a2[0]) * dy - (p2[1] - a2[1]) * dx) / len;
    sum += across * across;
  }
  return Math.sqrt(sum / pts.length);
}
function onLine(a2, b2, p2) {
  const dx = b2[0] - a2[0];
  const dy = b2[1] - a2[1];
  const t2 = ((p2[0] - a2[0]) * dx + (p2[1] - a2[1]) * dy) / Math.max(dx * dx + dy * dy, MIN_SPAN_PX);
  return [a2[0] + t2 * dx, a2[1] + t2 * dy];
}
function instanceFrame(matrix) {
  const col = (i2) => new THREE11.Vector3(matrix[4 * i2], matrix[4 * i2 + 1], matrix[4 * i2 + 2]);
  return {
    centre: new THREE11.Vector3(matrix[12], matrix[13], matrix[14]),
    axis: col(1).multiplyScalar(HALF_AXIS),
    ux: col(0),
    uz: col(2)
  };
}
function screenBasis(screen, centre, u2, v2) {
  const c2 = screen(centre);
  const a2 = screen(centre.clone().add(u2));
  const b2 = screen(centre.clone().add(v2));
  return { c: c2, ua: [a2[0] - c2[0], a2[1] - c2[1]], ub: [b2[0] - c2[0], b2[1] - c2[1]] };
}
function capEllipse(screen, centre, u2, v2) {
  const { c: c2, ua, ub } = screenBasis(screen, centre, u2, v2);
  return ellipseFromBasis(c2, ua, ub);
}
function sphereCurves(view2, centre, radius) {
  const image = view2.sphereImage(view2.toCam(centre), radius);
  return image ? [{ kind: "ellipse", e: { cx: image.cx, cy: image.cy, rx: image.rx, ry: image.ry, phi: image.phi } }] : [];
}
function cylinderCurves(matrix, screen) {
  const { centre, axis, ux, uz } = instanceFrame(matrix);
  const ends = [centre.clone().sub(axis), centre.clone().add(axis)];
  const caps = ends.map((end) => capEllipse(screen, end, ux, uz));
  const pa = screen(ends[0]);
  const pb = screen(ends[1]);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_SPAN_PX) return caps.map((e3) => ({ kind: "ellipse", e: e3 }));
  const n2 = [-dy / len, dx / len];
  const support = (e3) => Math.hypot(
    e3.rx * Math.cos(e3.phi) * n2[0] + e3.rx * Math.sin(e3.phi) * n2[1],
    e3.ry * Math.sin(e3.phi) * n2[0] - e3.ry * Math.cos(e3.phi) * n2[1]
  );
  const sa = support(caps[0]);
  const sb = support(caps[1]);
  const sides = [1, -1].map((side) => ({
    kind: "line",
    a: [pa[0] + side * n2[0] * sa, pa[1] + side * n2[1] * sa],
    b: [pb[0] + side * n2[0] * sb, pb[1] + side * n2[1] * sb]
  }));
  return [...caps.map((e3) => ({ kind: "ellipse", e: e3 })), ...sides];
}
function coneCurves(matrix, screen) {
  const { centre, axis, ux, uz } = instanceFrame(matrix);
  const apex = screen(centre.clone().add(axis));
  const { c: c2, ua, ub } = screenBasis(screen, centre.clone().sub(axis), ux, uz);
  const ellipse = { kind: "ellipse", e: ellipseFromBasis(c2, ua, ub) };
  const touches = tangentPoints(c2, ua, ub, apex);
  if (!touches) return [ellipse];
  return [ellipse, ...touches.map((p2) => ({ kind: "line", a: apex, b: p2 }))];
}
function tangentPoints(c2, ua, ub, apex) {
  const det = ua[0] * ub[1] - ub[0] * ua[1];
  if (Math.abs(det) < MIN_SPAN_PX * MIN_SPAN_PX) return null;
  const w2 = [apex[0] - c2[0], apex[1] - c2[1]];
  const qx = (ub[1] * w2[0] - ub[0] * w2[1]) / det;
  const qy = (-ua[1] * w2[0] + ua[0] * w2[1]) / det;
  const d2 = qx * qx + qy * qy;
  if (d2 <= 1) return null;
  const s2 = Math.sqrt(d2 - 1);
  const onEllipse = (sign) => {
    const u2 = (qx - sign * s2 * qy) / d2;
    const v2 = (qy + sign * s2 * qx) / d2;
    return [c2[0] + ua[0] * u2 + ub[0] * v2, c2[1] + ua[1] * u2 + ub[1] * v2];
  };
  return [onEllipse(1), onEllipse(-1)];
}
function edgeCurves(edges, screen) {
  return edges.map(([p2, q]) => ({ kind: "line", a: screen(p2), b: screen(q) }));
}
function sectionCurve(centre, radius, face, screen) {
  const [p0, p1, p2] = face;
  const n2 = new THREE11.Triangle(p0, p1, p2).getNormal(new THREE11.Vector3());
  const d2 = n2.dot(new THREE11.Vector3().subVectors(centre, p0));
  if (Math.abs(d2) >= radius) return null;
  const foot = centre.clone().addScaledVector(n2, -d2);
  const rho = Math.sqrt(radius * radius - d2 * d2);
  const u2 = new THREE11.Vector3().subVectors(p1, p0).normalize();
  const v2 = new THREE11.Vector3().crossVectors(n2, u2).normalize();
  return { kind: "ellipse", e: capEllipse(screen, foot, u2.clone().multiplyScalar(rho), v2.clone().multiplyScalar(rho)) };
}
function cylinderSectionCurve(matrix, face, screen) {
  const [p0, p1, p2] = face;
  const n2 = new THREE11.Triangle(p0, p1, p2).getNormal(new THREE11.Vector3());
  const c2 = new THREE11.Vector3(matrix[12], matrix[13], matrix[14]);
  const axisFull = new THREE11.Vector3(matrix[4], matrix[5], matrix[6]);
  const radius = new THREE11.Vector3(matrix[0], matrix[1], matrix[2]).length();
  const dir = axisFull.clone().normalize();
  const cosAlpha = Math.abs(n2.dot(dir));
  if (cosAlpha < PARALLEL_COS) return null;
  const t2 = n2.dot(new THREE11.Vector3().subVectors(p0, c2)) / n2.dot(dir);
  const centre = c2.clone().addScaledVector(dir, t2);
  const along = dir.clone().addScaledVector(n2, -dir.dot(n2)).normalize();
  const across = new THREE11.Vector3().crossVectors(n2, along).normalize();
  return {
    kind: "ellipse",
    e: capEllipse(
      screen,
      centre,
      along.clone().multiplyScalar(radius / cosAlpha),
      across.clone().multiplyScalar(radius)
    )
  };
}

// src/trace/buffers.ts
var BACKGROUND_DEPTH = 2;
var litKey = (id) => 2 * id;
var darkKey = (id) => 2 * id + 1;
var idOf = (key2) => key2 >> 1;
var Passes = class {
  constructor(width, height, keys, depth, shell, lineId) {
    this.width = width;
    this.height = height;
    this.keys = keys;
    this.depth = depth;
    this.shell = shell;
    this.lineId = lineId;
  }
  keyAt(x2, y2) {
    return this.read(this.keys, x2, y2);
  }
  shellAt(x2, y2) {
    return this.read(this.shell, x2, y2) === 1;
  }
  lineIdAt(x2, y2) {
    return this.read(this.lineId, x2, y2);
  }
  read(values, x2, y2) {
    if (x2 < 0 || y2 < 0 || x2 >= this.width || y2 >= this.height) return 0;
    return values[y2 * this.width + x2];
  }
};
var OUT_OF_RANGE = 1 << 30;
function objectBoxes(passes, count2) {
  const { keys, depth, width } = passes;
  const pixels = new Uint32Array(count2 + 1);
  const boxes = new Int32Array((count2 + 1) * 4);
  const nearest = new Float64Array(count2 + 1).fill(BACKGROUND_DEPTH);
  for (let id = 0; id <= count2; id++) boxes.set([OUT_OF_RANGE, OUT_OF_RANGE, -1, -1], 4 * id);
  for (let p2 = 0; p2 < keys.length; p2++) {
    const k = keys[p2];
    if (k === 0) continue;
    const id = idOf(k);
    const b2 = 4 * id;
    nearest[id] = Math.min(nearest[id], depth[p2]);
    pixels[id]++;
    const x2 = p2 % width;
    const y2 = (p2 - x2) / width;
    if (x2 < boxes[b2]) boxes[b2] = x2;
    if (y2 < boxes[b2 + 1]) boxes[b2 + 1] = y2;
    if (x2 > boxes[b2 + 2]) boxes[b2 + 2] = x2;
    if (y2 > boxes[b2 + 3]) boxes[b2 + 3] = y2;
  }
  return { boxes, nearest, pixels };
}
function boxOf(boxes, id) {
  return { x0: boxes[4 * id], y0: boxes[4 * id + 1], x1: boxes[4 * id + 2], y1: boxes[4 * id + 3] };
}
function keyAtCentre(passes, p2) {
  return idOf(passes.keyAt(Math.floor(p2.x), Math.floor(p2.y)));
}

// src/trace/measure.ts
import * as THREE12 from "three";

// node_modules/d3-polygon/dist/d3-polygon.mjs
function area(polygon) {
  var i2 = -1, n2 = polygon.length, a2, b2 = polygon[n2 - 1], area3 = 0;
  while (++i2 < n2) {
    a2 = b2;
    b2 = polygon[i2];
    area3 += a2[1] * b2[0] - a2[0] * b2[1];
  }
  return area3 / 2;
}
function length(polygon) {
  var i2 = -1, n2 = polygon.length, b2 = polygon[n2 - 1], xa, ya, xb = b2[0], yb = b2[1], perimeter = 0;
  while (++i2 < n2) {
    xa = xb;
    ya = yb;
    b2 = polygon[i2];
    xb = b2[0];
    yb = b2[1];
    xa -= xb;
    ya -= yb;
    perimeter += Math.hypot(xa, ya);
  }
  return perimeter;
}

// src/trace/measure.ts
function nearestFace(faces, p2, screen) {
  let best = null;
  let bestDist = Infinity;
  for (const f2 of faces) {
    const d2 = triangleDistance(p2, screen(f2[0]), screen(f2[1]), screen(f2[2]));
    if (d2 < bestDist) {
      bestDist = d2;
      best = [f2[0], f2[1], f2[2]];
    }
  }
  return best;
}
function triangleDistance(p2, a2, b2, c2) {
  const sign = (u2, v2, w2) => (v2[0] - u2[0]) * (w2[1] - u2[1]) - (v2[1] - u2[1]) * (w2[0] - u2[0]);
  const s1 = sign(a2, b2, p2);
  const s2 = sign(b2, c2, p2);
  const s3 = sign(c2, a2, p2);
  if (s1 >= 0 && s2 >= 0 && s3 >= 0 || s1 <= 0 && s2 <= 0 && s3 <= 0) return 0;
  return Math.min(segmentDistance(p2, a2, b2), segmentDistance(p2, b2, c2), segmentDistance(p2, c2, a2));
}
function segmentDistance(p2, a2, b2) {
  const point = new THREE12.Vector3(p2[0], p2[1], 0);
  const segment = new THREE12.Line3(new THREE12.Vector3(a2[0], a2[1], 0), new THREE12.Vector3(b2[0], b2[1], 0));
  const nearest = segment.distance() > 0 ? segment.closestPointToPoint(point, true, new THREE12.Vector3()) : segment.start;
  return nearest.distanceTo(point);
}
function ringArea(ring, scale) {
  return Math.abs(area(ring)) / (scale * scale);
}
function ringPerimeter(ring, scale) {
  return length(ring) / scale;
}

// src/trace/edges.ts
var SAMPLE_SPACING_PX = 0.5;
var MAX_SAMPLES_PER_IMAGE_EDGE = 4;
var NDC_DEPTH_MIN = -1;
var NDC_DEPTH_MAX = 1;
function runsWhere(count2, on) {
  const runs = [];
  let start = -1;
  for (let k = 0; k <= count2; k++) {
    const now = on(k);
    if (now && start < 0) start = k;
    if ((!now || k === count2) && start >= 0) {
      runs.push([start, now ? k : k - 1]);
      start = -1;
    }
  }
  return runs;
}
var LinePass = class {
  constructor(project, passes, scale) {
    this.project = project;
    this.passes = passes;
    this.scale = scale;
  }
  // The visible spans of the segment a-b of line `id`, as CSS px segments.
  spansOf(a2, b2, id) {
    const pa = this.project(a2);
    const pb = this.project(b2);
    if (!onScreen(pa) || !onScreen(pb)) return [];
    const outputLength = Math.hypot(pb.x - pa.x, pb.y - pa.y) / this.scale;
    const sampleLimit = MAX_SAMPLES_PER_IMAGE_EDGE * (this.passes.width + this.passes.height) / SAMPLE_SPACING_PX;
    const count2 = Math.min(sampleLimit, Math.max(1, Math.ceil(outputLength / SAMPLE_SPACING_PX)));
    const visible = (k) => {
      const p2 = this.project(a2.clone().lerp(b2, k / count2));
      return this.shows(id, Math.floor(p2.x), Math.floor(p2.y));
    };
    return runsWhere(count2, visible).map(([first, last]) => [
      this.cssAt(a2, b2, first / count2),
      this.cssAt(a2, b2, last / count2)
    ]);
  }
  // Whether any pixel of the 3x3 block around (x, y) shows line `id`.
  shows(id, x2, y2) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.passes.lineIdAt(x2 + dx, y2 + dy) === id) return true;
      }
    }
    return false;
  }
  cssAt(a2, b2, t2) {
    const p2 = this.project(a2.clone().lerp(b2, t2));
    return [p2.x / this.scale, p2.y / this.scale];
  }
};
function onScreen(p2) {
  return Number.isFinite(p2.x) && Number.isFinite(p2.y) && p2.depth >= NDC_DEPTH_MIN && p2.depth <= NDC_DEPTH_MAX;
}

// node_modules/d3-array/dist/d3-array.mjs
function ascending(a2, b2) {
  return a2 == null || b2 == null ? NaN : a2 < b2 ? -1 : a2 > b2 ? 1 : a2 >= b2 ? 0 : NaN;
}
function descending(a2, b2) {
  return a2 == null || b2 == null ? NaN : b2 < a2 ? -1 : b2 > a2 ? 1 : b2 >= a2 ? 0 : NaN;
}
function bisector(f2) {
  let compare1, compare2, delta;
  if (f2.length !== 2) {
    compare1 = ascending;
    compare2 = (d2, x2) => ascending(f2(d2), x2);
    delta = (d2, x2) => f2(d2) - x2;
  } else {
    compare1 = f2 === ascending || f2 === descending ? f2 : zero;
    compare2 = f2;
    delta = f2;
  }
  function left(a2, x2, lo = 0, hi = a2.length) {
    if (lo < hi) {
      if (compare1(x2, x2) !== 0) return hi;
      do {
        const mid = lo + hi >>> 1;
        if (compare2(a2[mid], x2) < 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  }
  function right(a2, x2, lo = 0, hi = a2.length) {
    if (lo < hi) {
      if (compare1(x2, x2) !== 0) return hi;
      do {
        const mid = lo + hi >>> 1;
        if (compare2(a2[mid], x2) <= 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  }
  function center(a2, x2, lo = 0, hi = a2.length) {
    const i2 = left(a2, x2, lo, hi - 1);
    return i2 > lo && delta(a2[i2 - 1], x2) > -delta(a2[i2], x2) ? i2 - 1 : i2;
  }
  return { left, center, right };
}
function zero() {
  return 0;
}
function number(x2) {
  return x2 === null ? NaN : +x2;
}
var ascendingBisect = bisector(ascending);
var bisectRight = ascendingBisect.right;
var bisectLeft = ascendingBisect.left;
var bisectCenter = bisector(number).center;
var blur2 = Blur2(blurf);
var blurImage = Blur2(blurfImage);
function Blur2(blur) {
  return function(data, rx, ry = rx) {
    if (!((rx = +rx) >= 0)) throw new RangeError("invalid rx");
    if (!((ry = +ry) >= 0)) throw new RangeError("invalid ry");
    let { data: values, width, height } = data;
    if (!((width = Math.floor(width)) >= 0)) throw new RangeError("invalid width");
    if (!((height = Math.floor(height !== void 0 ? height : values.length / width)) >= 0)) throw new RangeError("invalid height");
    if (!width || !height || !rx && !ry) return data;
    const blurx = rx && blur(rx);
    const blury = ry && blur(ry);
    const temp = values.slice();
    if (blurx && blury) {
      blurh(blurx, temp, values, width, height);
      blurh(blurx, values, temp, width, height);
      blurh(blurx, temp, values, width, height);
      blurv(blury, values, temp, width, height);
      blurv(blury, temp, values, width, height);
      blurv(blury, values, temp, width, height);
    } else if (blurx) {
      blurh(blurx, values, temp, width, height);
      blurh(blurx, temp, values, width, height);
      blurh(blurx, values, temp, width, height);
    } else if (blury) {
      blurv(blury, values, temp, width, height);
      blurv(blury, temp, values, width, height);
      blurv(blury, values, temp, width, height);
    }
    return data;
  };
}
function blurh(blur, T2, S2, w2, h2) {
  for (let y2 = 0, n2 = w2 * h2; y2 < n2; ) {
    blur(T2, S2, y2, y2 += w2, 1);
  }
}
function blurv(blur, T2, S2, w2, h2) {
  for (let x2 = 0, n2 = w2 * h2; x2 < w2; ++x2) {
    blur(T2, S2, x2, x2 + n2, w2);
  }
}
function blurfImage(radius) {
  const blur = blurf(radius);
  return (T2, S2, start, stop, step) => {
    start <<= 2, stop <<= 2, step <<= 2;
    blur(T2, S2, start + 0, stop + 0, step);
    blur(T2, S2, start + 1, stop + 1, step);
    blur(T2, S2, start + 2, stop + 2, step);
    blur(T2, S2, start + 3, stop + 3, step);
  };
}
function blurf(radius) {
  const radius0 = Math.floor(radius);
  if (radius0 === radius) return bluri(radius);
  const t2 = radius - radius0;
  const w2 = 2 * radius + 1;
  return (T2, S2, start, stop, step) => {
    if (!((stop -= step) >= start)) return;
    let sum = radius0 * S2[start];
    const s0 = step * radius0;
    const s1 = s0 + step;
    for (let i2 = start, j2 = start + s0; i2 < j2; i2 += step) {
      sum += S2[Math.min(stop, i2)];
    }
    for (let i2 = start, j2 = stop; i2 <= j2; i2 += step) {
      sum += S2[Math.min(stop, i2 + s0)];
      T2[i2] = (sum + t2 * (S2[Math.max(start, i2 - s1)] + S2[Math.min(stop, i2 + s1)])) / w2;
      sum -= S2[Math.max(start, i2 - s0)];
    }
  };
}
function bluri(radius) {
  const w2 = 2 * radius + 1;
  return (T2, S2, start, stop, step) => {
    if (!((stop -= step) >= start)) return;
    let sum = radius * S2[start];
    const s2 = step * radius;
    for (let i2 = start, j2 = start + s2; i2 < j2; i2 += step) {
      sum += S2[Math.min(stop, i2)];
    }
    for (let i2 = start, j2 = stop; i2 <= j2; i2 += step) {
      sum += S2[Math.min(stop, i2 + s2)];
      T2[i2] = sum / w2;
      sum -= S2[Math.max(start, i2 - s2)];
    }
  };
}
function count(values, valueof) {
  let count2 = 0;
  if (valueof === void 0) {
    for (let value of values) {
      if (value != null && (value = +value) >= value) {
        ++count2;
      }
    }
  } else {
    let index = -1;
    for (let value of values) {
      if ((value = valueof(value, ++index, values)) != null && (value = +value) >= value) {
        ++count2;
      }
    }
  }
  return count2;
}
function extent(values, valueof) {
  let min;
  let max2;
  if (valueof === void 0) {
    for (const value of values) {
      if (value != null) {
        if (min === void 0) {
          if (value >= value) min = max2 = value;
        } else {
          if (min > value) min = value;
          if (max2 < value) max2 = value;
        }
      }
    }
  } else {
    let index = -1;
    for (let value of values) {
      if ((value = valueof(value, ++index, values)) != null) {
        if (min === void 0) {
          if (value >= value) min = max2 = value;
        } else {
          if (min > value) min = value;
          if (max2 < value) max2 = value;
        }
      }
    }
  }
  return [min, max2];
}
var array = Array.prototype;
var slice = array.slice;
var e10 = Math.sqrt(50);
var e5 = Math.sqrt(10);
var e2 = Math.sqrt(2);
function tickSpec(start, stop, count2) {
  const step = (stop - start) / Math.max(0, count2), power = Math.floor(Math.log10(step)), error = step / Math.pow(10, power), factor = error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1;
  let i1, i2, inc;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count2 && count2 < 2) return tickSpec(start, stop, count2 * 2);
  return [i1, i2, inc];
}
function ticks(start, stop, count2) {
  stop = +stop, start = +start, count2 = +count2;
  if (!(count2 > 0)) return [];
  if (start === stop) return [start];
  const reverse = stop < start, [i1, i2, inc] = reverse ? tickSpec(stop, start, count2) : tickSpec(start, stop, count2);
  if (!(i2 >= i1)) return [];
  const n2 = i2 - i1 + 1, ticks2 = new Array(n2);
  if (reverse) {
    if (inc < 0) for (let i3 = 0; i3 < n2; ++i3) ticks2[i3] = (i2 - i3) / -inc;
    else for (let i3 = 0; i3 < n2; ++i3) ticks2[i3] = (i2 - i3) * inc;
  } else {
    if (inc < 0) for (let i3 = 0; i3 < n2; ++i3) ticks2[i3] = (i1 + i3) / -inc;
    else for (let i3 = 0; i3 < n2; ++i3) ticks2[i3] = (i1 + i3) * inc;
  }
  return ticks2;
}
function tickIncrement(start, stop, count2) {
  stop = +stop, start = +start, count2 = +count2;
  return tickSpec(start, stop, count2)[2];
}
function nice(start, stop, count2) {
  let prestep;
  while (true) {
    const step = tickIncrement(start, stop, count2);
    if (step === prestep || step === 0 || !isFinite(step)) {
      return [start, stop];
    } else if (step > 0) {
      const i2 = Math.ceil(start / step);
      const j2 = Math.floor(stop / step);
      start = (i2 - (i2 * step > start)) * step;
      stop = (j2 + (j2 * step < stop)) * step;
    } else if (step < 0) {
      const s2 = -step;
      const i2 = Math.ceil(start * s2);
      const j2 = Math.floor(stop * s2);
      start = (i2 - (i2 / s2 > start)) / s2;
      stop = (j2 + (j2 / s2 < stop)) / s2;
    }
    prestep = step;
  }
}
function thresholdSturges(values) {
  return Math.max(1, Math.ceil(Math.log(count(values)) / Math.LN2) + 1);
}
var shuffle = shuffler(Math.random);
function shuffler(random) {
  return function shuffle2(array3, i0 = 0, i1 = array3.length) {
    let m2 = i1 - (i0 = +i0);
    while (m2) {
      const i2 = random() * m2-- | 0, t2 = array3[m2 + i0];
      array3[m2 + i0] = array3[i2 + i0];
      array3[i2 + i0] = t2;
    }
    return array3;
  };
}

// node_modules/d3-contour/dist/d3-contour.mjs
var array2 = Array.prototype;
var slice2 = array2.slice;
function ascending2(a2, b2) {
  return a2 - b2;
}
function area2(ring) {
  var i2 = 0, n2 = ring.length, area3 = ring[n2 - 1][1] * ring[0][0] - ring[n2 - 1][0] * ring[0][1];
  while (++i2 < n2) area3 += ring[i2 - 1][1] * ring[i2][0] - ring[i2 - 1][0] * ring[i2][1];
  return area3;
}
var constant = (x2) => () => x2;
function contains(ring, hole) {
  var i2 = -1, n2 = hole.length, c2;
  while (++i2 < n2) if (c2 = ringContains(ring, hole[i2])) return c2;
  return 0;
}
function ringContains(ring, point) {
  var x2 = point[0], y2 = point[1], contains2 = -1;
  for (var i2 = 0, n2 = ring.length, j2 = n2 - 1; i2 < n2; j2 = i2++) {
    var pi = ring[i2], xi = pi[0], yi = pi[1], pj = ring[j2], xj = pj[0], yj = pj[1];
    if (segmentContains(pi, pj, point)) return 0;
    if (yi > y2 !== yj > y2 && x2 < (xj - xi) * (y2 - yi) / (yj - yi) + xi) contains2 = -contains2;
  }
  return contains2;
}
function segmentContains(a2, b2, c2) {
  var i2;
  return collinear(a2, b2, c2) && within(a2[i2 = +(a2[0] === b2[0])], c2[i2], b2[i2]);
}
function collinear(a2, b2, c2) {
  return (b2[0] - a2[0]) * (c2[1] - a2[1]) === (c2[0] - a2[0]) * (b2[1] - a2[1]);
}
function within(p2, q, r2) {
  return p2 <= q && q <= r2 || r2 <= q && q <= p2;
}
function noop() {
}
var cases = [
  [],
  [[[1, 1.5], [0.5, 1]]],
  [[[1.5, 1], [1, 1.5]]],
  [[[1.5, 1], [0.5, 1]]],
  [[[1, 0.5], [1.5, 1]]],
  [[[1, 1.5], [0.5, 1]], [[1, 0.5], [1.5, 1]]],
  [[[1, 0.5], [1, 1.5]]],
  [[[1, 0.5], [0.5, 1]]],
  [[[0.5, 1], [1, 0.5]]],
  [[[1, 1.5], [1, 0.5]]],
  [[[0.5, 1], [1, 0.5]], [[1.5, 1], [1, 1.5]]],
  [[[1.5, 1], [1, 0.5]]],
  [[[0.5, 1], [1.5, 1]]],
  [[[1, 1.5], [1.5, 1]]],
  [[[0.5, 1], [1, 1.5]]],
  []
];
function Contours() {
  var dx = 1, dy = 1, threshold = thresholdSturges, smooth = smoothLinear;
  function contours(values) {
    var tz = threshold(values);
    if (!Array.isArray(tz)) {
      const e3 = extent(values, finite);
      tz = ticks(...nice(e3[0], e3[1], tz), tz);
      while (tz[tz.length - 1] >= e3[1]) tz.pop();
      while (tz[1] < e3[0]) tz.shift();
    } else {
      tz = tz.slice().sort(ascending2);
    }
    return tz.map((value) => contour(values, value));
  }
  function contour(values, value) {
    const v2 = value == null ? NaN : +value;
    if (isNaN(v2)) throw new Error(`invalid value: ${value}`);
    var polygons = [], holes = [];
    isorings(values, v2, function(ring) {
      smooth(ring, values, v2);
      if (area2(ring) > 0) polygons.push([ring]);
      else holes.push(ring);
    });
    holes.forEach(function(hole) {
      for (var i2 = 0, n2 = polygons.length, polygon; i2 < n2; ++i2) {
        if (contains((polygon = polygons[i2])[0], hole) !== -1) {
          polygon.push(hole);
          return;
        }
      }
    });
    return {
      type: "MultiPolygon",
      value,
      coordinates: polygons
    };
  }
  function isorings(values, value, callback) {
    var fragmentByStart = new Array(), fragmentByEnd = new Array(), x2, y2, t0, t1, t2, t3;
    x2 = y2 = -1;
    t1 = above(values[0], value);
    cases[t1 << 1].forEach(stitch);
    while (++x2 < dx - 1) {
      t0 = t1, t1 = above(values[x2 + 1], value);
      cases[t0 | t1 << 1].forEach(stitch);
    }
    cases[t1 << 0].forEach(stitch);
    while (++y2 < dy - 1) {
      x2 = -1;
      t1 = above(values[y2 * dx + dx], value);
      t2 = above(values[y2 * dx], value);
      cases[t1 << 1 | t2 << 2].forEach(stitch);
      while (++x2 < dx - 1) {
        t0 = t1, t1 = above(values[y2 * dx + dx + x2 + 1], value);
        t3 = t2, t2 = above(values[y2 * dx + x2 + 1], value);
        cases[t0 | t1 << 1 | t2 << 2 | t3 << 3].forEach(stitch);
      }
      cases[t1 | t2 << 3].forEach(stitch);
    }
    x2 = -1;
    t2 = values[y2 * dx] >= value;
    cases[t2 << 2].forEach(stitch);
    while (++x2 < dx - 1) {
      t3 = t2, t2 = above(values[y2 * dx + x2 + 1], value);
      cases[t2 << 2 | t3 << 3].forEach(stitch);
    }
    cases[t2 << 3].forEach(stitch);
    function stitch(line) {
      var start = [line[0][0] + x2, line[0][1] + y2], end = [line[1][0] + x2, line[1][1] + y2], startIndex = index(start), endIndex = index(end), f2, g2;
      if (f2 = fragmentByEnd[startIndex]) {
        if (g2 = fragmentByStart[endIndex]) {
          delete fragmentByEnd[f2.end];
          delete fragmentByStart[g2.start];
          if (f2 === g2) {
            f2.ring.push(end);
            callback(f2.ring);
          } else {
            fragmentByStart[f2.start] = fragmentByEnd[g2.end] = { start: f2.start, end: g2.end, ring: f2.ring.concat(g2.ring) };
          }
        } else {
          delete fragmentByEnd[f2.end];
          f2.ring.push(end);
          fragmentByEnd[f2.end = endIndex] = f2;
        }
      } else if (f2 = fragmentByStart[endIndex]) {
        if (g2 = fragmentByEnd[startIndex]) {
          delete fragmentByStart[f2.start];
          delete fragmentByEnd[g2.end];
          if (f2 === g2) {
            f2.ring.push(end);
            callback(f2.ring);
          } else {
            fragmentByStart[g2.start] = fragmentByEnd[f2.end] = { start: g2.start, end: f2.end, ring: g2.ring.concat(f2.ring) };
          }
        } else {
          delete fragmentByStart[f2.start];
          f2.ring.unshift(start);
          fragmentByStart[f2.start = startIndex] = f2;
        }
      } else {
        fragmentByStart[startIndex] = fragmentByEnd[endIndex] = { start: startIndex, end: endIndex, ring: [start, end] };
      }
    }
  }
  function index(point) {
    return point[0] * 2 + point[1] * (dx + 1) * 4;
  }
  function smoothLinear(ring, values, value) {
    ring.forEach(function(point) {
      var x2 = point[0], y2 = point[1], xt = x2 | 0, yt = y2 | 0, v1 = valid(values[yt * dx + xt]);
      if (x2 > 0 && x2 < dx && xt === x2) {
        point[0] = smooth1(x2, valid(values[yt * dx + xt - 1]), v1, value);
      }
      if (y2 > 0 && y2 < dy && yt === y2) {
        point[1] = smooth1(y2, valid(values[(yt - 1) * dx + xt]), v1, value);
      }
    });
  }
  contours.contour = contour;
  contours.size = function(_2) {
    if (!arguments.length) return [dx, dy];
    var _0 = Math.floor(_2[0]), _1 = Math.floor(_2[1]);
    if (!(_0 >= 0 && _1 >= 0)) throw new Error("invalid size");
    return dx = _0, dy = _1, contours;
  };
  contours.thresholds = function(_2) {
    return arguments.length ? (threshold = typeof _2 === "function" ? _2 : Array.isArray(_2) ? constant(slice2.call(_2)) : constant(_2), contours) : threshold;
  };
  contours.smooth = function(_2) {
    return arguments.length ? (smooth = _2 ? smoothLinear : noop, contours) : smooth === smoothLinear;
  };
  return contours;
}
function finite(x2) {
  return isFinite(x2) ? x2 : NaN;
}
function above(x2, value) {
  return x2 == null ? false : +x2 >= value;
}
function valid(v2) {
  return v2 == null || isNaN(v2 = +v2) ? -Infinity : v2;
}
function smooth1(x2, v0, v1, value) {
  const a2 = value - v0;
  const b2 = v1 - v0;
  const d2 = isFinite(a2) || isFinite(b2) ? a2 / b2 : Math.sign(a2) / Math.sign(b2);
  return isNaN(d2) ? x2 : x2 + d2 - 0.5;
}

// src/trace/field.ts
var FIELD_RADIUS_PX = 1;
var FIELD_BORDER_PX = 2;
var ISO_LEVEL = 0.5;
function regionRings(passes, box, match) {
  if (box.x1 < box.x0) return [];
  const cols = box.x1 - box.x0 + 1 + 2 * FIELD_BORDER_PX;
  const rows = box.y1 - box.y0 + 1 + 2 * FIELD_BORDER_PX;
  const mask = new Float64Array(cols * rows);
  for (let y2 = box.y0; y2 <= box.y1; y2++) {
    for (let x2 = box.x0; x2 <= box.x1; x2++) {
      if (match(passes.keys[y2 * passes.width + x2]))
        mask[(y2 - box.y0 + FIELD_BORDER_PX) * cols + (x2 - box.x0 + FIELD_BORDER_PX)] = 1;
    }
  }
  const field = boxBlur(boxBlur(mask, cols, rows, FIELD_RADIUS_PX, true), cols, rows, FIELD_RADIUS_PX, false);
  const multi = Contours().size([cols, rows]).thresholds([ISO_LEVEL])(Array.from(field))[0];
  const offsetX = box.x0 - FIELD_BORDER_PX + 0.5;
  const offsetY = box.y0 - FIELD_BORDER_PX + 0.5;
  const rings = [];
  for (const polygon of multi.coordinates) {
    for (const ring of polygon) {
      const points = ring.slice(0, -1).map(([gx, gy]) => [gx + offsetX, gy + offsetY]);
      if (points.length >= 3) rings.push(points);
    }
  }
  return rings;
}
function boxBlur(src, cols, rows, radius, horizontal) {
  const out = new Float64Array(cols * rows);
  const weight = 1 / (2 * radius + 1);
  const length2 = horizontal ? cols : rows;
  for (let line = 0; line < (horizontal ? rows : cols); line++) {
    for (let i2 = 0; i2 < length2; i2++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const j2 = Math.min(length2 - 1, Math.max(0, i2 + k));
        sum += horizontal ? src[line * cols + j2] : src[j2 * cols + line];
      }
      if (horizontal) out[line * cols + i2] = sum * weight;
      else out[i2 * cols + line] = sum * weight;
    }
  }
  return out;
}

// src/trace/stretch.ts
var SNAP_TOL_RENDER_PX = 0.6;
var BAND_OFFSETS_PX = [0.5, 1, 1.5];
var FLAG_HALF_WINDOW = 3;
var BACKGROUND = 0;
var PIXEL_CENTRE = 0.5;
function stretchesOf(ring, id, passes, scale) {
  const labels = fillGaps(ring.map(([x2, y2]) => labelAt(x2, y2, id, passes)));
  if (labels === null) return { stretches: [], whole: false };
  const css = ring.map(([x2, y2]) => [x2 / scale, y2 / scale]);
  const ctx = { id, passes, scale };
  if (labels.every((l2) => l2 === labels[0])) return wholeRing(css, labels[0], ctx);
  const [pts, rotatedLabels] = rotateToChange(css, labels);
  return { stretches: splitAtLabelChanges(pts, rotatedLabels, ctx), whole: false };
}
function wholeRing(css, label, ctx) {
  const flags = shellFlags(css, true, ctx);
  if (flags.every((f2) => f2 === flags[0])) return { stretches: [{ pts: css, label, outlined: flags[0] }], whole: true };
  return { stretches: cyclicRuns(css, flags, label), whole: false };
}
function fillGaps(labels) {
  const first = labels.find((l2) => l2 !== null);
  if (first === void 0) return null;
  let prev = first;
  return labels.map((l2) => {
    if (l2 === null) return prev;
    prev = l2;
    return l2;
  });
}
function rotateToChange(css, labels) {
  const start = labels.findIndex((l2, i2) => l2 !== labels[(i2 - 1 + labels.length) % labels.length]);
  return [
    [...css.slice(start), ...css.slice(0, start)],
    [...labels.slice(start), ...labels.slice(0, start)]
  ];
}
function splitAtLabelChanges(pts, labels, ctx) {
  const stretches = [];
  for (let i2 = 0; i2 < pts.length; ) {
    let j2 = i2;
    while (j2 + 1 < pts.length && labels[j2 + 1] === labels[i2]) j2++;
    const span2 = pts.slice(i2, j2 + 1);
    for (const piece of runsOf(span2, shellFlags(span2, false, ctx))) {
      stretches.push({ pts: piece.pts, label: labels[i2], outlined: piece.outlined });
    }
    i2 = j2 + 1;
  }
  return stretches;
}
function labelAt(x2, y2, id, passes) {
  const left = Math.floor(x2 - PIXEL_CENTRE);
  const top = Math.floor(y2 - PIXEL_CENTRE);
  let inside = false;
  const votes = [];
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const key2 = passes.keyAt(left + dx, top + dy);
      if (key2 !== 0 && idOf(key2) === id) {
        inside = true;
        continue;
      }
      votes.push(key2 === 0 ? BACKGROUND : idOf(key2));
    }
  }
  return inside ? mostCommon(votes) : null;
}
function mostCommon(values) {
  const counts = /* @__PURE__ */ new Map();
  for (const v2 of values) counts.set(v2, (counts.get(v2) ?? 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [value, count2] of counts) {
    if (count2 > bestCount) {
      best = value;
      bestCount = count2;
    }
  }
  return best;
}
function shellFlags(pts, closed, ctx) {
  const n2 = pts.length;
  const raw = pts.map((p2, i2) => {
    const a2 = closed ? pts[(i2 - 1 + n2) % n2] : pts[Math.max(0, i2 - 1)];
    const b2 = closed ? pts[(i2 + 1) % n2] : pts[Math.min(n2 - 1, i2 + 1)];
    const [nx, ny] = outwardNormal(p2, a2, b2, ctx);
    let hits = 0;
    for (const d2 of BAND_OFFSETS_PX)
      if (shellAt([p2[0] + nx * d2 / ctx.scale, p2[1] + ny * d2 / ctx.scale], ctx)) hits++;
    return hits * 2 > BAND_OFFSETS_PX.length;
  });
  return majority(raw, closed);
}
function outwardNormal(p2, a2, b2, ctx) {
  const tx = b2[0] - a2[0];
  const ty = b2[1] - a2[1];
  const len = Math.hypot(tx, ty) || 1;
  const n2 = [ty / len, -tx / len];
  return ownAt([p2[0] + n2[0] / ctx.scale, p2[1] + n2[1] / ctx.scale], ctx) ? [-n2[0], -n2[1]] : n2;
}
function majority(flags, closed) {
  const n2 = flags.length;
  return flags.map((_2, i2) => {
    let count2 = 0;
    let seen = 0;
    for (let k = -FLAG_HALF_WINDOW; k <= FLAG_HALF_WINDOW; k++) {
      const j2 = closed ? (i2 + k + n2 * 2) % n2 : i2 + k;
      if (j2 < 0 || j2 >= n2) continue;
      seen++;
      if (flags[j2]) count2++;
    }
    return count2 * 2 > seen;
  });
}
var pixelOf = (p2, ctx) => [Math.floor(p2[0] * ctx.scale), Math.floor(p2[1] * ctx.scale)];
function ownAt(p2, ctx) {
  const key2 = ctx.passes.keyAt(...pixelOf(p2, ctx));
  return key2 !== 0 && idOf(key2) === ctx.id;
}
function shellAt(p2, ctx) {
  return ctx.passes.shellAt(...pixelOf(p2, ctx));
}
function runsOf(pts, flags) {
  const out = [];
  if (pts.length < 2) return [{ pts, outlined: flags[0] }];
  let i2 = 0;
  while (i2 < pts.length - 1) {
    let j2 = i2 + 1;
    while (j2 + 1 < pts.length && flags[j2 + 1] === flags[i2]) j2++;
    out.push({ pts: pts.slice(i2, j2 + 1), outlined: flags[i2] });
    i2 = j2;
  }
  return out;
}
function cyclicRuns(pts, flags, label) {
  const n2 = pts.length;
  const change = flags.findIndex((f2, i2) => f2 !== flags[(i2 - 1 + n2) % n2]);
  const from = Math.max(0, change);
  const rotatedPts = [...pts.slice(from), ...pts.slice(0, from), pts[from]];
  const rotatedFlags = [...flags.slice(from), ...flags.slice(0, from), flags[from]];
  return runsOf(rotatedPts, rotatedFlags).map((piece) => ({ pts: piece.pts, label, outlined: piece.outlined }));
}
function ringPaths(stretches, whole, candidates, tol) {
  if (stretches.length === 0) return { fill: "", outline: "" };
  if (whole) {
    const st = stretches[0];
    const best = bestCurve(candidates(st), st.pts, tol);
    if (best?.kind === "ellipse") {
      const start = startOf(best.e, st.pts[0]);
      const seam = pointAt(best.e, paramOf(best.e, st.pts[0]));
      const d4 = `M${start}${fullEllipseArcs(best.e, seam)}Z`;
      return { fill: d4, outline: st.outlined ? d4 : "" };
    }
    const d3 = closedPath(st.pts);
    return { fill: d3, outline: st.outlined ? d3 : "" };
  }
  const bests = stretches.map((st) => bestCurve(candidates(st), st.pts, tol));
  let cur = startOn(bests[0], stretches[0].pts[0]);
  let d2 = `M${fmtPt(cur)}`;
  const pieces = [];
  stretches.forEach((st, index) => {
    const start = cur;
    const piece = pieceFor(st, bests[index], start);
    cur = piece.end;
    d2 += piece.cmd;
    pieces.push({ start, cmd: piece.cmd, outlined: st.outlined });
  });
  d2 += "Z";
  return { fill: d2, outline: outlineOf2(pieces) };
}
function pieceFor(st, best, start) {
  const last = st.pts[st.pts.length - 1];
  if (best?.kind === "line") {
    const end = onLine(best.a, best.b, last);
    return { cmd: `L${fmtPt(end)}`, end };
  }
  if (best?.kind === "ellipse") {
    const end = pointAt(best.e, paramOf(best.e, last));
    return { cmd: arcTo(best.e, pointAt(best.e, paramOf(best.e, start)), end, st.pts), end };
  }
  return { cmd: fitCommands([start, ...st.pts.slice(1)]), end: last };
}
function outlineOf2(pieces) {
  let out = "";
  let open = false;
  for (const p2 of pieces) {
    if (!p2.outlined) {
      open = false;
      continue;
    }
    if (!open) out += `M${fmtPt(p2.start)}`;
    out += p2.cmd;
    open = true;
  }
  return out;
}
function bestCurve(curves, pts, tol) {
  let best = null;
  let bestRms = tol;
  for (const c2 of curves) {
    const rms = curveRms(c2, pts);
    if (rms <= bestRms) {
      best = c2;
      bestRms = rms;
    }
  }
  return best;
}
function snapTolerance(scale) {
  return SNAP_TOL_RENDER_PX / scale;
}
function startOn(curve, p2) {
  if (!curve) return p2;
  if (curve.kind === "line") return onLine(curve.a, curve.b, p2);
  return pointAt(curve.e, paramOf(curve.e, p2));
}
function startOf(e3, p2) {
  return fmtPt(pointAt(e3, paramOf(e3, p2)));
}

// src/trace/regions.ts
var SEAM_TRAP_PX = 0.5;
var SEAM_STROKE_WIDTH = 2 * SEAM_TRAP_PX;
var SILHOUETTE_SAMPLES = 48;
var MIN_REGION_PX = 4;
var MIN_STRIP_PX = 1;
var MIN_SILHOUETTE_PX = 1;
var MIN_PERIMETER_PX = 1e-9;
var Layers = class {
  clips = [];
  fills = [];
  outlines = [];
  paths = 0;
  counted(node) {
    this.paths++;
    return node;
  }
};
function curveLookup(own, crossing) {
  const ownOf = memo(own);
  const candidatesFor = (id, st) => {
    if (st.label <= 0) return ownOf(id);
    const mid = st.pts[Math.floor(st.pts.length / 2)];
    return [...ownOf(id), ...ownOf(st.label), ...crossing(id, st.label, mid)];
  };
  return { own: ownOf, candidatesFor };
}
function ownCurves(obj, view2) {
  switch (obj.kind) {
    case "sphere":
    case "dot":
      return sphereCurves(view2, vec3(obj.centre), obj.matrix[0]);
    case "cylinder":
      return cylinderCurves(obj.matrix, screenOf(view2));
    case "cone":
      return coneCurves(obj.matrix, screenOf(view2));
    case "polyhedron":
      return [];
  }
}
function traceRegions(g2) {
  const layers = new Layers();
  for (const { id, obj } of drawOrder(g2)) {
    if (obj.kind !== "polyhedron" && g2.thin(obj)) traceThin(g2, layers, id, obj);
    else traceObject(g2, layers, id, obj);
  }
  return layers;
}
function drawOrder(g2) {
  return g2.objects.map((obj, i2) => ({
    id: i2 + 1,
    nearestDepth: g2.thin(obj) ? g2.project(vec3(obj.centre)).depth : g2.stats.nearest[i2 + 1],
    obj
  })).sort((p2, q) => q.nearestDepth - p2.nearestDepth);
}
function traceObject(g2, layers, id, obj) {
  const box = boxOf(g2.stats.boxes, id);
  if (box.x1 < box.x0) return;
  const rgb = g2.paint.rgb(obj);
  const lit = srgbHex(rgb);
  const dark = shadedBand(rgb, LOOK.dark);
  const common = { "fill-rule": "evenodd", ...obj.alpha < 1 ? { "fill-opacity": obj.alpha } : {} };
  const region = regionFill(g2, id, obj, box);
  const body = [];
  if (region.fill) {
    body.push(layers.counted(seamTrapped(region.fill, lit, common)));
    const clipPath = svgEl("path", { d: region.fill, "clip-rule": "evenodd" });
    layers.clips.push(svgEl("clipPath", { id: clipId(g2, id) }, [clipPath]));
  }
  const band = darkBandPath(g2, id, box);
  if (band)
    body.push(
      layers.counted(
        seamTrapped(band, dark, { ...common, "clip-path": region.fill ? `url(#${clipId(g2, id)})` : void 0 })
      )
    );
  const edge = g2.edgeLine(id);
  if (edge) body.push(layers.counted(edge));
  const opacity = g2.paint.opacity(obj);
  layers.fills.push(svgEl("g", opacity < 1 ? { opacity } : {}, body));
  if (g2.outlines.on && obj.outlined && region.outline) {
    const outline = layers.counted(outlineMarkup(g2, obj, region.outline));
    layers.outlines.push(opacity < 1 ? svgEl("g", { opacity }, [outline]) : outline);
  }
}
function clipId(g2, id) {
  return `${g2.clipPrefix}${id}`;
}
function regionFill(g2, id, obj, box) {
  const { passes, stats, scale } = g2;
  const regionPx = stats.pixels[id] / (scale * scale);
  if (regionPx < MIN_REGION_PX) return { fill: tinySilhouette(g2, id, obj, regionPx), outline: "" };
  let fill = "";
  let outline = "";
  const rings = regionRings(passes, box, (k) => idOf(k) === id).filter(
    (ring) => ringArea(ring, scale) >= MIN_REGION_PX
  );
  for (const ring of rings) {
    const { stretches, whole } = stretchesOf(ring, id, passes, scale);
    const parts = ringPaths(stretches, whole, (st) => g2.curves.candidatesFor(id, st), g2.tol);
    fill += parts.fill;
    outline += parts.outline;
  }
  return { fill, outline };
}
function tinySilhouette(g2, id, obj, regionPx) {
  const exact = g2.curves.own(id).find((c2) => c2.kind === "ellipse");
  const centre = g2.project(vec3(obj.centre));
  if (!exact || keyAtCentre(g2.passes, centre) !== id || regionPx < MIN_SILHOUETTE_PX) return "";
  return closedPath(silhouettePoints(exact.e));
}
function darkBandPath(g2, id, box) {
  const { passes, scale } = g2;
  const rings = regionRings(passes, box, (k) => k === darkKey(id)).filter(
    (ring) => ringArea(ring, scale) >= MIN_REGION_PX && ringArea(ring, scale) / Math.max(ringPerimeter(ring, scale), MIN_PERIMETER_PX) >= MIN_STRIP_PX
  );
  return rings.map((ring) => closedPath(toCss(ring, scale))).join("");
}
function toCss(ring, scale) {
  return ring.map(([x2, y2]) => [x2 / scale, y2 / scale]);
}
function outlineMarkup(g2, obj, d2) {
  const r2 = g2.outlines.capped ? radiusPx(g2.view, obj) : null;
  const width = r2 === null ? g2.outlines.width / 2 : Math.min(g2.outlines.width / 2, 2 * OUTLINE_SIZE_FRACTION * r2);
  const strokeWidth = g2.outlines.scale * width;
  return svgEl("path", {
    d: d2,
    fill: "none",
    stroke: g2.outlines.hex,
    "stroke-width": strokeWidth,
    "stroke-linejoin": "round"
  });
}
function seamTrapped(d2, colour, extra) {
  return svgEl("path", {
    d: d2,
    fill: colour,
    stroke: colour,
    "stroke-width": SEAM_STROKE_WIDTH,
    "stroke-linejoin": "round",
    ...extra
  });
}
function traceThin(g2, layers, id, obj) {
  const lit = srgbHex(g2.paint.rgb(obj));
  const radius = radiusPx(g2.view, obj) ?? 0;
  const thin = obj.kind === "dot" ? dotMarkup(obj, lit, id, g2.linePass, radius) : barMarkup(obj, lit, id, g2.linePass, radius);
  if (!thin) return;
  const opacity = g2.paint.opacity(obj);
  layers.fills.push(layers.counted(opacity < 1 ? svgEl("g", { opacity }, [thin]) : thin));
}
function dotMarkup(obj, lit, id, lines, radius) {
  const p2 = lines.project(vec3(obj.centre));
  if (!onScreen(p2)) return null;
  if (!lines.shows(id, Math.floor(p2.x), Math.floor(p2.y))) return null;
  return svgEl("circle", { cx: p2.x / lines.scale, cy: p2.y / lines.scale, r: radius, fill: lit });
}
function barMarkup(obj, lit, id, lines, radius) {
  const c2 = vec3(obj.centre);
  const { axis } = instanceFrame(obj.matrix);
  const d2 = segmentsPath(lines.spansOf(c2.clone().sub(axis), c2.clone().add(axis), id));
  return d2 ? svgEl("path", { d: d2, fill: "none", stroke: lit, "stroke-width": 2 * radius, "stroke-linecap": "round" }) : null;
}
function silhouettePoints(e3) {
  return Array.from({ length: SILHOUETTE_SAMPLES }, (_2, i2) => pointAt(e3, 2 * Math.PI * i2 / SILHOUETTE_SAMPLES));
}
function radiusPx(view2, obj) {
  if (obj.kind === "polyhedron") return null;
  const m2 = obj.matrix;
  let unit = null;
  if (obj.kind === "cylinder") unit = Math.hypot(m2[0], m2[1], m2[2]);
  else if (obj.kind === "sphere" || obj.kind === "dot") unit = m2[0];
  return unit === null ? null : unit * view2.pxPerUnit(view2.toCam(vec3(obj.centre)));
}
function screenOf(view2) {
  return (p2) => {
    const s2 = view2.toScreen(view2.toCam(p2));
    return [s2.x, s2.y];
  };
}
function memo(compute) {
  const cache = /* @__PURE__ */ new Map();
  return (key2) => {
    if (!cache.has(key2)) cache.set(key2, compute(key2));
    return cache.get(key2);
  };
}

// src/trace/objects.ts
import * as THREE13 from "three";
var roleOf = (mesh) => mesh.userData;
function buildIdMeshes(data, material, keep = () => true) {
  const objects = [];
  const parts = { meshes: [], shells: [], thin: [] };
  for (const group of instanceGroups(data)) addInstanceGroup(group, objects, parts, material, keep);
  addPolyhedra2(data, objects, parts, material);
  return { objects, ...parts };
}
function addInstanceGroup(group, objects, parts, material, keep) {
  const first = objects.length + 1;
  const kept = [];
  const dropped = [];
  group.refs.forEach((_2, i2) => {
    const obj = {
      kind: group.shape,
      material: group.material,
      alpha: 1,
      outlined: group.outlined,
      centre: instanceCentre(group.matrices, i2),
      matrix: group.matrices.slice(MATRIX_SIZE * i2, MATRIX_SIZE * (i2 + 1))
    };
    objects.push(obj);
    (keep(obj) ? kept : dropped).push(i2);
  });
  if (kept.length) {
    const mesh = instanceSet(group, first, kept, material);
    mesh.userData = { shape: group.shape, role: "solid" };
    parts.meshes.push(mesh);
    if (group.outlined) {
      const shell = instanceSet(group, first, kept, material);
      shell.userData = { shape: group.shape, role: "shell" };
      parts.shells.push(shell);
    }
  }
  if (dropped.length) {
    const mesh = instanceSet(group, first, dropped, material);
    mesh.userData = { shape: group.shape, role: "thin" };
    parts.thin.push(mesh);
  }
}
function addPolyhedra2(data, objects, parts, material) {
  const points = new Map(data.points.map((p2) => [p2.id, p2.position]));
  const polyBase = objects.length;
  data.primitives.polyhedra.forEach((poly, index) => {
    const material2 = data.materials[poly.material_id];
    objects.push({
      kind: "polyhedron",
      material: poly.material_id,
      alpha: material2.alpha,
      outlined: !isGhost(material2),
      centre: points.get(poly.center_point_id),
      poly: index
    });
  });
  for (const group of polyhedronGroups(data)) {
    const ids = new Float32Array(group.owner.length * 3);
    group.owner.forEach((p2, t2) => {
      ids.fill(polyBase + p2 + 1, t2 * 3, t2 * 3 + 3);
    });
    const geometry = new THREE13.BufferGeometry();
    geometry.setAttribute("position", new THREE13.Float32BufferAttribute(group.positions, 3));
    geometry.setAttribute("objectId", new THREE13.BufferAttribute(ids, 1));
    geometry.computeVertexNormals();
    const mesh = new THREE13.Mesh(geometry, material);
    mesh.userData = { shape: "polyhedron", role: "solid" };
    parts.meshes.push(mesh);
    if (group.material && !isGhost(data.materials[group.material])) {
      const shell = new THREE13.Mesh(geometry, material);
      shell.userData = { shape: "polyhedron", role: "shell" };
      parts.shells.push(shell);
    }
  }
}
function instanceCentre(matrices, i2) {
  const at = MATRIX_SIZE * i2;
  return [matrices[at + 12], matrices[at + 13], matrices[at + 14]];
}
function instanceSet(group, first, indices, material) {
  const ids = new Float32Array(indices.length);
  indices.forEach((i2, k) => {
    ids[k] = first + i2;
  });
  const matrices = indices.flatMap((i2) => group.matrices.slice(MATRIX_SIZE * i2, MATRIX_SIZE * (i2 + 1)));
  const geometry = SHAPES[group.shape]();
  geometry.setAttribute("objectId", new THREE13.InstancedBufferAttribute(ids, 1));
  return instanced(geometry, material, matrices);
}

// src/trace/passes.ts
import * as THREE14 from "three";
var DEPTH_SCALE = 16777215;
var ID_VERTEX = `
    attribute float objectId;
    flat varying float vObject;
    void main() {
      vObject = objectId;
      vec4 local = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        local = instanceMatrix * local;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * local;
    }`;
var ID_FRAGMENT = `
    flat varying float vObject;
    void main() {
      float lo = mod(vObject, 256.0);
      float mid = mod(floor(vObject / 256.0), 256.0);
      float hi = floor(vObject / 65536.0);
      gl_FragColor = vec4(lo, mid, hi, 255.0) / 255.0;
    }`;
var BAND_VERTEX = `
    varying vec3 vNormal;
    void main() {
      vec3 n = normal;
      vec4 local = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        mat3 m = mat3(instanceMatrix);
        // dividing each column by its squared length gives the inverse transpose for a scaled instance
        n = m * (n / vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2])));
        local = instanceMatrix * local;
      #endif
      vNormal = normalMatrix * n;
      gl_Position = projectionMatrix * modelViewMatrix * local;
    }`;
var BAND_FRAGMENT = `
    uniform vec3 lightDir; // view space, unit length: towards the key light
    uniform float litCut; // N.L at which the toon gradient turns lit
    varying vec3 vNormal;
    void main() {
      float lit = dot(normalize(vNormal), lightDir) >= litCut ? 1.0 : 0.0;
      gl_FragColor = vec4(lit, 0.0, 0.0, 1.0);
    }`;
var DEPTH_FRAGMENT = `
    void main() {
      float v = floor(gl_FragCoord.z * ${DEPTH_SCALE.toFixed(1)} + 0.5);
      gl_FragColor = vec4(mod(v, 256.0), mod(floor(v / 256.0), 256.0), floor(v / 65536.0), 255.0) / 255.0;
    }`;
var PLAIN_VERTEX = `
    void main() {
      vec4 local = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        local = instanceMatrix * local;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * local;
    }`;
var PASS_SHADERS = {
  id: { vertexShader: ID_VERTEX, fragmentShader: ID_FRAGMENT, uniforms: () => ({}) },
  band: {
    vertexShader: BAND_VERTEX,
    fragmentShader: BAND_FRAGMENT,
    uniforms: () => ({ lightDir: { value: new THREE14.Vector3(...LOOK.key).normalize() }, litCut: { value: LIT_CUT } })
  },
  depth: { vertexShader: PLAIN_VERTEX, fragmentShader: DEPTH_FRAGMENT, uniforms: () => ({}) }
};
function passMaterial(pass, faces) {
  const { vertexShader, fragmentShader, uniforms } = PASS_SHADERS[pass];
  return new THREE14.ShaderMaterial({ vertexShader, fragmentShader, uniforms: uniforms(), ...polygonOffsetOf(faces) });
}
function idScene(meshes, origin) {
  const group = new THREE14.Group();
  group.position.copy(origin);
  group.add(...meshes);
  const scene2 = new THREE14.Scene();
  scene2.add(group);
  return scene2;
}
var CHANNEL_ON = 128;
function unpack24(bytes, offset) {
  return bytes[offset] + 256 * bytes[offset + 1] + 65536 * bytes[offset + 2];
}
var SHELL_FRAGMENT = `
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }`;
var ZERO_FRAGMENT = `
    void main() {
      gl_FragColor = vec4(0.0);
    }`;
var shellMaterial = (outlineScale2) => new THREE14.ShaderMaterial({
  vertexShader: OUTLINE_VERTEX_SHADER,
  fragmentShader: SHELL_FRAGMENT,
  side: THREE14.BackSide,
  uniforms: { outlineThickness: { value: OUTLINE_THICKNESS }, outlineScale: { value: outlineScale2 } }
});
var occluderMaterial = (faces) => new THREE14.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: ZERO_FRAGMENT, ...polygonOffsetOf(faces) });
function renderPasses(groups, options) {
  const { meshes, shells, thin, lines } = groups;
  const { cssWidth, cssHeight, scale, outlineScale: outlineScale2, view: view2 } = options;
  const { camera: camera2 } = view2;
  const width = cssWidth * scale;
  const height = cssHeight * scale;
  const count2 = width * height;
  const passes = new Passes(
    width,
    height,
    new Uint32Array(count2),
    new Float32Array(count2).fill(BACKGROUND_DEPTH),
    new Uint8Array(count2),
    new Uint32Array(count2)
  );
  const all = [...meshes, ...shells, ...thin, ...lines];
  const scene2 = idScene(all, view2.origin);
  const used = [];
  const keep = (material) => {
    used.push(material);
    return material;
  };
  const solid = (pass) => {
    const atoms = keep(passMaterial(pass, false));
    const faces = keep(passMaterial(pass, true));
    return (mesh) => roleOf(mesh).shape === "polyhedron" ? faces : atoms;
  };
  const idSolid = solid("id");
  const bandSolid = solid("band");
  const depthSolid = solid("depth");
  const maskShell = keep(shellMaterial(outlineScale2));
  const maskPlain = keep(occluderMaterial(false));
  const maskFaces = keep(occluderMaterial(true));
  const occluder = (mesh) => roleOf(mesh).shape === "polyhedron" ? maskFaces : maskPlain;
  const lineIdMaterial = keep(passMaterial("id", false));
  const PASSES = [
    { read: "ids", shown: null, materialOf: idSolid },
    { read: "bands", shown: null, materialOf: bandSolid },
    { read: "depths", shown: null, materialOf: depthSolid },
    {
      read: "masks",
      shown: "shells",
      materialOf: (mesh) => roleOf(mesh).role === "shell" ? maskShell : occluder(mesh)
    },
    {
      read: "lineIds",
      shown: "lines",
      materialOf: (mesh) => {
        const { role } = roleOf(mesh);
        return role === "line" || role === "thin" ? lineIdMaterial : occluder(mesh);
      }
    }
  ];
  const showOnly = (shown2) => {
    for (const m2 of shells) m2.visible = shown2 === "shells";
    for (const m2 of [...thin, ...lines]) m2.visible = shown2 === "lines";
  };
  const tile = renderer.capabilities.maxTextureSize;
  camera2.updateMatrixWorld();
  try {
    for (let y0 = 0; y0 < height; y0 += tile) {
      for (let x0 = 0; x0 < width; x0 += tile) {
        const tw = Math.min(tile, width - x0);
        const th = Math.min(tile, height - y0);
        camera2.setViewOffset(width, height, x0, y0, tw, th);
        const reads = {};
        for (const step of PASSES) {
          showOnly(step.shown);
          reads[step.read] = readPass(scene2, camera2, all, step.materialOf, tw, th);
        }
        storeTile(passes, { x0, y0, tw, th, ...reads });
      }
    }
  } finally {
    renderer.setRenderTarget(null);
    camera2.clearViewOffset();
    for (const material of used) material.dispose();
  }
  return passes;
}
function storeTile(out, t2) {
  for (let row = 0; row < t2.th; row++) {
    const topRow = t2.th - 1 - row;
    for (let col = 0; col < t2.tw; col++) {
      const src = (row * t2.tw + col) * 4;
      const dst = (t2.y0 + topRow) * out.width + t2.x0 + col;
      out.shell[dst] = t2.masks[src] >= CHANNEL_ON ? 1 : 0;
      out.lineId[dst] = unpack24(t2.lineIds, src);
      const id = unpack24(t2.ids, src);
      if (id === 0) continue;
      out.keys[dst] = t2.bands[src] < CHANNEL_ON ? darkKey(id) : litKey(id);
      out.depth[dst] = unpack24(t2.depths, src) / DEPTH_SCALE;
    }
  }
}
function readPass(scene2, camera2, all, materialOf, tw, th) {
  for (const mesh of all) mesh.material = materialOf(mesh);
  const target = new THREE14.WebGLRenderTarget(tw, th, {
    depthBuffer: true,
    minFilter: THREE14.NearestFilter,
    magFilter: THREE14.NearestFilter,
    generateMipmaps: false
  });
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene2, camera2);
    const pixels = new Uint8Array(tw * th * 4);
    renderer.readRenderTargetPixels(target, 0, 0, tw, th, pixels);
    return pixels;
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
  }
}
function disposeMeshes(meshes) {
  for (const mesh of meshes) mesh.geometry.dispose();
}
function projector(width, height, view2) {
  return (p2) => {
    const { camera: camera2 } = view2;
    const ndc = p2.clone().add(view2.origin).applyMatrix4(camera2.matrixWorldInverse).applyMatrix4(camera2.projectionMatrix);
    return { x: (ndc.x + 1) / 2 * width, y: (1 - ndc.y) / 2 * height, depth: ndc.z / 2 + 0.5 };
  };
}

// src/trace/triad-trace.ts
import * as THREE15 from "three";
var CLIP_PREFIX = "t";
function traceTriad(o2, view2, scale) {
  const directions = o2.lattice.map((vector) => {
    const v2 = vec3(vector);
    return [v2.dot(view2.right), v2.dot(view2.up), v2.dot(view2.back)];
  });
  const layout = triadLayout(directions, o2.width, o2.height);
  const exact = triadCorner(layout, o2.width, o2.height);
  const corner = { ...exact, width: Math.ceil(exact.width), height: Math.ceil(exact.height) };
  const top = o2.height - corner.height;
  const orientation = new THREE15.Quaternion().fromArray(o2.quaternion);
  const camera2 = new THREE15.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  placeTriadCamera(camera2, orientation, corner, layout.length);
  const model = triadModel(
    layout.length,
    o2.lattice.map((vector) => new THREE15.Vector3(...vector))
  );
  const fadeOf = (part) => part.axis === null ? 0 : layout.items.find((item) => item.index === part.axis)?.fade ?? 0;
  const parts = model.map((part) => ({ part, fade: fadeOf(part) }));
  const { meshes, shells, dispose } = solidMeshes(model);
  const pass = { camera: camera2, origin: new THREE15.Vector3() };
  const passes = renderPasses(
    { meshes, shells, thin: [], lines: [] },
    { cssWidth: corner.width, cssHeight: corner.height, scale, outlineScale: o2.outlineScale, view: pass }
  );
  const group = triadGroup({
    passes,
    project: projector(passes.width, passes.height, pass),
    view: viewOfCorner(orientation, [corner.originX, corner.height - corner.originY]),
    scale,
    parts,
    outlines: {
      on: o2.outlines,
      hex: linearHex(LOOK.outline),
      width: OUTLINE_THICKNESS * corner.height,
      scale: o2.outlineScale,
      // The live triad's shells are plain meshes, so their outline is not capped to the arrow's radius.
      capped: false
    }
  });
  const layers = traceRegions(group);
  const letters = layout.items.map((item) => letter(item, layout.fontSize, top));
  dispose();
  return { node: triadNode(layers, letters, top), paths: layers.paths };
}
function solidMeshes(solids2) {
  const placeholder = new THREE15.MeshBasicMaterial();
  const meshes = [];
  const shells = [];
  solids2.forEach((part, index) => {
    const geometry = shapeGeometry(part.shape);
    const count2 = geometry.getAttribute("position").count;
    geometry.setAttribute("objectId", new THREE15.BufferAttribute(new Float32Array(count2).fill(index + 1), 1));
    meshes.push(placed(new THREE15.Mesh(geometry, placeholder), part, "solid"));
    shells.push(placed(new THREE15.Mesh(geometry, placeholder), part, "shell"));
  });
  const dispose = () => {
    disposeMeshes([...meshes, ...shells]);
    placeholder.dispose();
  };
  return { meshes, shells, dispose };
}
function placed(mesh, part, role) {
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.userData = { shape: part.shape.kind, role };
  return mesh;
}
function triadGroup({ passes, project, view: view2, scale, parts, outlines: outlines2 }) {
  const objects = parts.map(({ part }) => ({
    kind: part.shape.kind,
    material: null,
    alpha: 1,
    outlined: true,
    centre: [part.position.x, part.position.y, part.position.z],
    matrix: partMatrix(part)
  }));
  const index = new Map(objects.map((obj, i2) => [obj, i2]));
  const rgbOf = parts.map(({ part }) => hexRgb(part.colour));
  const own = (id) => ownCurves(objects[id - 1], view2);
  return {
    scale,
    objects,
    passes,
    stats: objectBoxes(passes, objects.length),
    view: view2,
    project,
    linePass: new LinePass(project, passes, scale),
    curves: curveLookup(own, () => []),
    tol: snapTolerance(scale),
    paint: {
      rgb: (obj) => rgbOf[index.get(obj)],
      opacity: (obj) => 1 - parts[index.get(obj)].fade
    },
    outlines: outlines2,
    thin: () => false,
    edgeLine: () => null,
    clipPrefix: CLIP_PREFIX
  };
}
function letter(item, fontSize, top) {
  const attrs = {
    x: item.label.x,
    y: item.label.y - top,
    fill: LOOK.axisColors[item.index],
    opacity: 1 - item.fade,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "font-family": `'${AXIS_FONT.family}', sans-serif`,
    "font-style": "italic",
    "font-weight": 700,
    "font-size": fontSize
  };
  return svgEl("text", attrs, [AXIS_LETTERS[item.index]]);
}
function triadNode(layers, letters, top) {
  return svgEl("g", { id: "triad", "stroke-linecap": "round", transform: `translate(0 ${fmt(top)})` }, [
    svgEl("defs", {}, layers.clips),
    ...layers.fills,
    ...layers.outlines,
    ...letters
  ]);
}
function hexRgb(hex) {
  return [1, 3, 5].map((i2) => parseInt(hex.slice(i2, i2 + 2), 16) / 255);
}

// src/trace/traced.ts
var TRACE_SCALE = 2;
var EDGE_WIDTH = 1;
var BOX_LINE_WIDTH = 1;
var THIN_AS_LINE_PX = 3;
function buildTracedSvg(options) {
  const started = performance.now();
  const view2 = makeView(options);
  const prepared = prepareScene(options, view2);
  try {
    const shown2 = (mesh) => options.show.atoms || roleOf(mesh).shape !== "sphere";
    const { built, lines } = prepared;
    const pass = { camera: camera.value, origin: root.position };
    const passes = renderPasses(
      { meshes: built.meshes.filter(shown2), shells: built.shells.filter(shown2), thin: built.thin, lines },
      {
        cssWidth: options.width,
        cssHeight: options.height,
        scale: TRACE_SCALE,
        outlineScale: options.outlineScale,
        view: pass
      }
    );
    const group = makeGroup(options, view2, prepared, passes, pass);
    const layers = traceRegions(group);
    const box = cellBoxMarkup(options, prepared, group.linePass, layers);
    const triad = traceTriad(options, view2, TRACE_SCALE);
    const text = documentText(options, layers, box, triad.node);
    return { text, paths: layers.paths + triad.paths, ms: performance.now() - started };
  } finally {
    disposeMeshes([...prepared.built.meshes, ...prepared.built.shells, ...prepared.built.thin, ...prepared.lines]);
  }
}
function prepareScene(options, view2) {
  const built = buildIdMeshes(options.data, passMaterial("id", false), (obj) => !isThin(view2, obj));
  const points = new Map(options.data.points.map((p2) => [p2.id, p2.position]));
  const topologies = new Map(options.data.topologies.map((t2) => [t2.id, t2]));
  const edgeSpans = [];
  let nextId = built.objects.length + 1;
  built.objects.forEach((obj, index) => {
    if (obj.kind !== "polyhedron") return;
    const poly = options.data.primitives.polyhedra[obj.poly];
    for (const [a2, b2] of polyhedronEdges(topologies.get(poly.topology_id), points))
      edgeSpans.push({ owner: index + 1, a: a2, b: b2, id: nextId++ });
  });
  const boxId = nextId;
  const boxEdges = options.show.box && options.data.cell ? cellEdges(options.data.cell).map(vectorPair) : [];
  const edgeLines = lineSet(edgeSpans.map((e3) => [e3.a, e3.b, e3.id]));
  const boxLines = lineSet(boxEdges.map(([a2, b2]) => [a2, b2, boxId]));
  const lines = [edgeLines, boxLines].filter((set) => set.geometry.getAttribute("position").count > 0);
  return { built, points, topologies, edgeSpans, boxEdges, boxId, lines };
}
function polyhedronEdges(topo, points) {
  return hardEdges(topo, points).map(vectorPair);
}
function vectorPair([a2, b2]) {
  return [vec3(a2), vec3(b2)];
}
function lineSet(segments) {
  const positions = new Float32Array(segments.length * 6);
  const ids = new Float32Array(segments.length * 2);
  segments.forEach(([a2, b2, id], k) => {
    positions.set([a2.x, a2.y, a2.z, b2.x, b2.y, b2.z], 6 * k);
    ids.set([id, id], 2 * k);
  });
  const geometry = new THREE16.BufferGeometry();
  geometry.setAttribute("position", new THREE16.BufferAttribute(positions, 3));
  geometry.setAttribute("objectId", new THREE16.BufferAttribute(ids, 1));
  const set = new THREE16.LineSegments(geometry, new THREE16.LineBasicMaterial());
  set.userData = { role: "line" };
  return set;
}
function makeGroup(options, view2, prepared, passes, pass) {
  const project = projector(passes.width, passes.height, pass);
  const linePass = new LinePass(project, passes, TRACE_SCALE);
  const edgeHex = srgbHex(LOOK.outline);
  const edgesOf = /* @__PURE__ */ new Map();
  for (const span2 of prepared.edgeSpans) {
    const list = edgesOf.get(span2.owner);
    if (list) list.push(span2);
    else edgesOf.set(span2.owner, [span2]);
  }
  return {
    scale: TRACE_SCALE,
    objects: prepared.built.objects,
    passes,
    stats: objectBoxes(passes, prepared.built.objects.length),
    view: view2,
    project,
    linePass,
    curves: makeCurveLookup(options, view2, prepared),
    tol: snapTolerance(TRACE_SCALE),
    paint: { rgb: (obj) => fillRgb(options, obj), opacity: () => 1 },
    // The live view's outline is OUTLINE_THICKNESS of the image height; a centred stroke of half of it shows its
    // visible width.
    outlines: {
      on: options.outlines,
      hex: linearHex(LOOK.outline),
      width: OUTLINE_THICKNESS * options.height,
      scale: options.outlineScale,
      capped: true
    },
    thin: (obj) => isThin(view2, obj),
    edgeLine: (id) => {
      const d2 = segmentsPath((edgesOf.get(id) ?? []).flatMap((e3) => linePass.spansOf(e3.a, e3.b, e3.id)));
      return d2 ? svgEl("path", { d: d2, fill: "none", stroke: edgeHex, "stroke-width": EDGE_WIDTH, "stroke-linecap": "round" }) : null;
    },
    clipPrefix: "k"
  };
}
function fillRgb(options, obj) {
  const rgb = obj.material === null ? ARROW.color : options.data.materials[obj.material].base_color;
  return rgb.slice(0, 3);
}
function documentText(options, layers, box, triad) {
  const svg = svgEl(
    "svg",
    { width: options.width, height: options.height, viewBox: `0 0 ${options.width} ${options.height}` },
    [
      svgEl("style", {}, [axisFontFace("700")]),
      svgEl("defs", {}, layers.clips),
      ...layers.fills,
      box,
      ...layers.outlines,
      triad
    ]
  );
  return `${new XMLSerializer().serializeToString(svg)}
`;
}
function cellBoxMarkup(options, prepared, linePass, layers) {
  if (!options.show.box || !options.data.cell) return null;
  const d2 = segmentsPath(prepared.boxEdges.flatMap(([a2, b2]) => linePass.spansOf(a2, b2, prepared.boxId)));
  return d2 ? layers.counted(svgEl("path", { d: d2, fill: "none", stroke: options.boxColor, "stroke-width": BOX_LINE_WIDTH })) : null;
}
function makeCurveLookup(options, view2, prepared) {
  const screen = screenOf(view2);
  const { built, points } = prepared;
  const own = (id) => {
    const obj = built.objects[id - 1];
    if (obj.kind === "polyhedron")
      return edgeCurves(polyhedronEdges(topologyOf(options, prepared, obj.poly), points), screen);
    return ownCurves(obj, view2);
  };
  const facesOf = memo((poly) => {
    const topo = topologyOf(options, prepared, poly);
    return topo.faces.map(([i2, j2, k]) => [i2, j2, k].map((q) => vec3(points.get(topo.point_ids[q]))));
  });
  const sectionOfFace = (poly, other, mid) => {
    const face = nearestFace(facesOf(poly.poly), mid, screen);
    return face ? sectionCurves(other, face, screen) : [];
  };
  const crossing = (id, label, mid) => {
    const a2 = built.objects[id - 1];
    const b2 = built.objects[label - 1];
    if (a2.kind === "polyhedron" && b2.kind !== "polyhedron") return sectionOfFace(a2, b2, mid);
    if (b2.kind === "polyhedron" && a2.kind !== "polyhedron") return sectionOfFace(b2, a2, mid);
    return [];
  };
  return curveLookup(own, crossing);
}
function sectionCurves(other, face, screen) {
  if (other.kind === "sphere" || other.kind === "dot") {
    const c2 = sectionCurve(vec3(other.centre), other.matrix[0], face, screen);
    return c2 ? [c2] : [];
  }
  if (other.kind === "cylinder") {
    const c2 = cylinderSectionCurve(other.matrix, face, screen);
    return c2 ? [c2] : [];
  }
  return [];
}
function topologyOf(options, prepared, poly) {
  return prepared.topologies.get(options.data.primitives.polyhedra[poly].topology_id);
}
function isThin(view2, obj) {
  return (obj.kind === "cylinder" || obj.kind === "dot") && (radiusPx(view2, obj) ?? Infinity) * 2 < THIN_AS_LINE_PX;
}

// src/export/settings.ts
var EXPORT_LONG_SIDE = 1600;
function exportView(view2) {
  const { quaternion, zoom: zoom2, target, centre, box, width, height } = view2;
  return {
    projection: view2.projection ?? "ortho",
    lens: view2.projection === "persp" ? view2.lens : void 0,
    direction: applyQuaternion(quaternion, [0, 0, 1]).map((x2) => roundTo(x2, 4)),
    up: applyQuaternion(quaternion, [0, 1, 0]).map((x2) => roundTo(x2, 4)),
    zoom: roundTo(zoom2, 3),
    target: target.map((t2, i2) => roundTo(t2 + centre[i2], 4)),
    cellBox: Boolean(box),
    resolution: resolutionFor(width, height)
  };
}
function settingsObject(view2) {
  return {
    look: { preset: "3to2d" },
    camera: {
      projection: view2.projection,
      ...view2.lens === void 0 ? {} : { lens: view2.lens },
      direction: view2.direction,
      up: view2.up,
      zoom: view2.zoom,
      target: view2.target
    },
    cell_box: { show: view2.cellBox },
    quality: { resolution: view2.resolution }
  };
}
var settingsJson = (view2) => `${JSON.stringify(settingsObject(view2), null, 2)}
`;
function settingsToml(view2) {
  return Object.entries(settingsObject(view2)).map(
    ([table, keys]) => `[${table}]
${Object.entries(keys).map(([k, v2]) => `${k} = ${tomlValue(v2)}`).join("\n")}
`
  ).join("\n");
}
function renderCommand(view2, sceneFile) {
  const [w2, h2] = view2.resolution;
  return [
    "gemmy render",
    "--scene",
    shellWord(sceneFile),
    "--look.preset 3to2d",
    `--camera.projection ${view2.projection}`,
    ...view2.lens === void 0 ? [] : [`--camera.lens ${view2.lens}`],
    `--camera.direction ${view2.direction.join(" ")}`,
    `--camera.up ${view2.up.join(" ")}`,
    `--camera.zoom ${view2.zoom}`,
    `--camera.target ${view2.target.join(" ")}`,
    `--cell-box.show ${view2.cellBox ? "True" : "False"}`,
    `--quality.resolution ${w2} ${h2}`,
    "--out view.png"
  ].join(" ");
}
function resolutionFor(width, height) {
  const scale = EXPORT_LONG_SIDE / Math.max(width, height);
  return [Math.round(width * scale), Math.round(height * scale)];
}
var roundTo = (x2, digits) => {
  const scale = 10 ** digits;
  return Math.round(x2 * scale) / scale || 0;
};
var tomlValue = (v2) => Array.isArray(v2) ? `[${v2.map(tomlValue).join(", ")}]` : JSON.stringify(v2);
var shellWord = (text) => /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;

// src/ui/export.ts
var PNG_SCALE = 2;
var KB = 1024;
var DOWNLOAD_REVOKE_MS = 1e4;
var DEFAULT_SCENE_FILE = "scene.json";
var currentView = () => exportView({
  ...pageCamera(),
  centre: loaded.value.centre,
  box: showBox.value
});
var exportStatus = byId("export-status");
function say(text, failed = false) {
  exportStatus.textContent = text;
  exportStatus.classList.toggle("err", failed);
}
function download(name, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), DOWNLOAD_REVOKE_MS);
}
function saveFile(name, type, text) {
  download(name, new Blob([text], { type }));
  say(`Saved ${name}.`);
}
var exportText = byId("export-text");
function showSelectedText(text, what) {
  exportText.value = text;
  exportText.hidden = false;
  exportText.focus();
  exportText.select();
  say(`Could not use the clipboard: ${what} is selected, press Ctrl/Cmd+C.`, true);
}
function copyText(text, what) {
  const fallback = () => showSelectedText(text, what);
  try {
    navigator.clipboard.writeText(text).then(() => {
      exportText.hidden = true;
      say(`Copied ${what}.`);
    }, fallback);
  } catch {
    fallback();
  }
}
function exportPng(transparent) {
  const w2 = stage.clientWidth, h2 = stage.clientHeight, ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(PNG_SCALE);
  renderer.setSize(w2, h2);
  renderer.render(scene, camera.value);
  renderTriad(transparent);
  const out = document.createElement("canvas");
  out.width = w2 * PNG_SCALE;
  out.height = h2 * PNG_SCALE;
  const ctx = out.getContext("2d");
  if (!transparent) {
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(renderer.domElement, 0, 0);
  ctx.drawImage(triadAt(PNG_SCALE, transparent), 0, 0);
  renderer.setPixelRatio(ratio);
  renderer.setSize(w2, h2);
  requestRender();
  out.toBlob((blob) => {
    if (blob) {
      download("view.png", blob);
      say(`Saved view.png (${out.width} \xD7 ${out.height}).`);
    } else {
      say("The browser could not make the PNG.", true);
    }
  }, "image/png");
}
function triadAt(scale, transparent) {
  const canvas = document.createElement("canvas");
  drawTriad(canvas, canvas.getContext("2d"), scale, transparent);
  return canvas;
}
function exportSvg() {
  const { data } = loaded.value;
  if (!data) {
    say("Load a scene first: there is no scene on show to export.", true);
    return;
  }
  const boxColor = getComputedStyle(document.documentElement).getPropertyValue("--box").trim();
  let result;
  try {
    result = buildTracedSvg({
      data,
      centre: loaded.value.centre,
      extent: loaded.value.extent,
      ...pageCamera(),
      show: { atoms: showAtoms.value, box: showBox.value },
      outlines: outlines.value,
      outlineScale: outlineScale.value,
      lattice: loaded.value.lattice.map((v2) => v2.toArray()),
      boxColor
    });
  } catch (error) {
    say(`The SVG export failed: ${error instanceof Error ? error.message : String(error)}`, true);
    return;
  } finally {
    requestRender();
  }
  download("view.svg", new Blob([result.text], { type: "image/svg+xml" }));
  if (result.paths === 0) {
    say("Saved view.svg, but nothing in this view is visible: the file has no shapes.", true);
    return;
  }
  say(
    `Saved view.svg (${Math.round(result.text.length / KB)} kB, ${result.paths} paths, ${Math.round(result.ms)} ms).`
  );
}
function sceneFileName() {
  const meta = document.querySelector('meta[name="gemmy-scene-file"]');
  return meta?.content || DEFAULT_SCENE_FILE;
}
var EXPORTS = /* @__PURE__ */ new Map([
  ["svg", exportSvg],
  ["png", () => exportPng(byId("png-transparent").checked)],
  ["save-toml", () => saveFile("render-settings.toml", "application/toml", settingsToml(currentView()))],
  ["save-json", () => saveFile("render-settings.json", "application/json", settingsJson(currentView()))],
  ["copy-toml", () => copyText(settingsToml(currentView()), "the TOML settings")],
  ["copy-json", () => copyText(settingsJson(currentView()), "the JSON settings")],
  ["copy-command", () => copyText(renderCommand(currentView(), sceneFileName()), "the command")]
]);
function registerExport(name, run) {
  EXPORTS.set(name, run);
}
function runExport(name, item) {
  EXPORTS.get(name ?? "")?.(item);
}

// src/ui/menus.ts
var POPOVER_GAP_PX = 6;
var POPOVER_MARGIN_PX = 8;
var POPOVER_CLEARANCE_PX = 14;
function placePopover(button, panel) {
  const r2 = button.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  const below = r2.top + r2.height / 2 < H / 2;
  panel.style.maxHeight = `${(below ? H - r2.bottom : r2.top) - POPOVER_CLEARANCE_PX}px`;
  const w2 = panel.offsetWidth, h2 = panel.offsetHeight;
  const left = r2.left + r2.width / 2 < W / 2 ? r2.left : r2.right - w2;
  panel.style.left = `${MathUtils8.clamp(left, POPOVER_MARGIN_PX, W - w2 - POPOVER_MARGIN_PX)}px`;
  panel.style.top = `${below ? r2.bottom + POPOVER_GAP_PX : r2.top - POPOVER_GAP_PX - h2}px`;
}
function focusable(panel) {
  return [...panel.querySelectorAll("button, input")].filter(
    (el) => !el.hidden && !el.closest("[hidden]")
  );
}
function moveFocus(key2, list) {
  const i2 = list.indexOf(document.activeElement);
  if (key2 === "ArrowDown") list[(i2 + 1) % list.length]?.focus();
  else if (key2 === "ArrowUp") list[(i2 + list.length - 1) % list.length]?.focus();
  else if (key2 === "Home") list[0]?.focus();
  else if (key2 === "End") list[list.length - 1]?.focus();
  else return false;
  return true;
}
function wirePopover(button, panel) {
  panel.addEventListener("toggle", (e3) => {
    const open = e3.newState === "open";
    button.setAttribute("aria-expanded", String(open));
    if (!open) return;
    placePopover(button, panel);
    focusable(panel)[0]?.focus();
  });
  panel.addEventListener("keydown", (e3) => {
    if (e3.key === "Tab") panel.hidePopover();
    else if (moveFocus(e3.key, focusable(panel))) e3.preventDefault();
  });
  window.addEventListener("resize", () => {
    if (panel.matches(":popover-open")) placePopover(button, panel);
  });
}
var exportMenu = byId("export-menu");
wirePopover(byId("export-button"), exportMenu);
var mainMenu = byId("main-menu");
wirePopover(byId("menu-button"), mainMenu);
byId("open-url").addEventListener("click", () => {
  mainMenu.hidePopover();
  showUrlForm();
});
var helpPanel = byId("help");
wirePopover(byId("help-button"), helpPanel);
exportMenu.addEventListener("click", (e3) => {
  const item = closestOf(e3.target, "[data-export]");
  if (item) runExport(item.dataset.export, item);
});

// src/ui/keyboard.ts
function arrow(dx, dy, shift) {
  if (shift) pan(dx, dy, STEP.pan);
  else if (dy) rotate("x", dy * STEP.rotate);
  else rotate("y", -dx * STEP.rotate);
}
var zoomIn = () => zoom(STEP.zoom);
var zoomOut = () => zoom(1 / STEP.zoom);
var KEY_ACTIONS = {
  ArrowUp: (shift) => arrow(0, 1, shift),
  ArrowDown: (shift) => arrow(0, -1, shift),
  ArrowLeft: (shift) => arrow(-1, 0, shift),
  ArrowRight: (shift) => arrow(1, 0, shift),
  "+": zoomIn,
  "=": zoomIn,
  "-": zoomOut,
  _: zoomOut,
  "0": () => fit(),
  "[": () => rotate("z", -STEP.rotate),
  "]": () => rotate("z", STEP.rotate),
  t: cycleTheme
  // Auto → Light → Dark
};
function isTurnKey(e3) {
  return e3.key.startsWith("Arrow") && !e3.shiftKey || e3.key === "[" || e3.key === "]";
}
function isForFieldOrShortcut(e3) {
  return closestOf(e3.target, "input, textarea, .popover") !== null || e3.metaKey || e3.ctrlKey || e3.altKey;
}
function runShortcut(e3) {
  if (e3.key === "?") {
    helpPanel.togglePopover();
    return true;
  }
  if (e3.key === "i" && !e3.shiftKey) {
    toggleInfo();
    return true;
  }
  if (FLY[e3.code]) {
    flying.add(e3.code);
    return true;
  }
  if (!Object.hasOwn(KEY_ACTIONS, e3.key)) return false;
  KEY_ACTIONS[e3.key](e3.shiftKey);
  return true;
}
function wireKeyboard() {
  window.addEventListener("keydown", (e3) => {
    setShiftHeld(e3.shiftKey);
    const menuOpen = document.querySelector(":popover-open") !== null;
    if (e3.key === "Escape" && !menuOpen && closeUrlForm()) return;
    if (isForFieldOrShortcut(e3)) return;
    if (e3.key === "Escape") {
      if (!menuOpen) {
        select(null);
        releasePivot();
      }
      return;
    }
    if (isTurnKey(e3) && !e3.repeat) beginRotation();
    if (runShortcut(e3)) e3.preventDefault();
  });
}

// src/ui/lens-bar.ts
var ORTHO_LENS = Infinity;
var ORTHO_TAG = "inf";
var lensGroup = byId("lens-group");
function isLensOn(button, persp, focal) {
  const value = button.dataset.lens;
  return value === ORTHO_TAG ? !persp : persp && Number(value) === focal;
}
function addLensButton(focalLength) {
  const ortho = focalLength === ORTHO_LENS;
  const button = document.createElement("button");
  Object.assign(button, {
    type: "button",
    className: "pill lens",
    textContent: ortho ? "\u221E" : String(focalLength),
    title: ortho ? "Orthographic (an infinitely long lens): no perspective, as in the 3to2d renders" : `${focalLength} mm lens on a ${GEMMY.sensorWidth} mm sensor`
  });
  button.dataset.lens = ortho ? ORTHO_TAG : String(focalLength);
  button.setAttribute("aria-label", ortho ? "Orthographic" : `${focalLength} mm`);
  button.addEventListener("click", () => {
    if (ortho) switchProjection("ortho");
    else switchProjection("persp", focalLength);
  });
  if (ortho) lensGroup.insertAdjacentHTML("beforeend", '<span class="unit">mm</span>');
  lensGroup.appendChild(button);
}
function wireLensBar() {
  for (const focalLength of [...GEMMY.lenses, ORTHO_LENS]) addLensButton(focalLength);
  x(() => {
    const persp = projection.value === "persp";
    for (const button of lensGroup.querySelectorAll("[data-lens]")) {
      button.setAttribute("aria-pressed", String(isLensOn(button, persp, lens.value)));
    }
  });
}

// src/ui/toolbar-buttons.ts
var HOLD_DELAY_MS = 300;
var CLICK = { held: false };
function act(button, amount) {
  const kind = button.dataset.act;
  const sign = Number(button.dataset.sign);
  if (kind === "rotate") {
    const turn = amount.held ? RATE.rotate * amount.seconds : STEP.rotate;
    const axis = button.dataset.axis;
    if (isScreenAxis(axis)) rotate(axis, sign * turn);
  } else if (kind === "pan") {
    const move2 = amount.held ? RATE.pan * amount.seconds : STEP.pan;
    pan(Number(button.dataset.dx), Number(button.dataset.dy), move2);
  } else if (kind === "zoom") {
    const factor = amount.held ? RATE.zoom ** amount.seconds : STEP.zoom;
    zoom(factor ** sign);
  } else if (kind === "fit") {
    fit();
  }
}
var waitsForRelease = (e3) => e3.pointerType === "touch";
var isRotateButton = (button) => button.dataset.act === "rotate";
function wirePressButton(button) {
  let press2 = null;
  const stop = () => {
    if (!press2) return;
    cancelAnimationFrame(press2.frame);
    window.clearTimeout(press2.timer);
    press2 = null;
  };
  const repeatWhileHeld = () => {
    if (!press2) return;
    press2.repeating = true;
    const tick = (t2) => {
      if (!press2) return;
      if (press2.last)
        act(button, { held: true, seconds: Math.min((t2 - press2.last) / MS_PER_SECOND, MAX_FRAME_SECONDS) });
      press2.last = t2;
      press2.frame = requestAnimationFrame(tick);
    };
    press2.frame = requestAnimationFrame(tick);
  };
  button.addEventListener("pointerdown", (e3) => {
    if (isRotateButton(button)) beginRotation();
    const waits = waitsForRelease(e3);
    if (!waits) {
      e3.preventDefault();
      button.setPointerCapture(e3.pointerId);
      act(button, CLICK);
    }
    press2 = { waitsForRelease: waits, last: 0, repeating: false, timer: 0, frame: 0 };
    if (button.dataset.act === "fit") return;
    press2.timer = window.setTimeout(repeatWhileHeld, HOLD_DELAY_MS);
  });
  button.addEventListener("pointerup", () => {
    if (press2?.waitsForRelease && !press2.repeating) act(button, CLICK);
    stop();
  });
  for (const ev of ["pointercancel", "lostpointercapture"]) button.addEventListener(ev, stop);
  button.addEventListener("click", (e3) => {
    if (e3.detail !== 0) return;
    if (isRotateButton(button)) beginRotation();
    act(button, CLICK);
  });
}
function wireToolbarButtons() {
  for (const button of document.querySelectorAll("[data-act]")) wirePressButton(button);
  for (const el of document.querySelectorAll(".island, .tabs")) watchOverflow(el);
  document.querySelector(".tabs [aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// src/ui/tooltip.ts
import { MathUtils as MathUtils9 } from "three";
var TIP_DELAY_MS = 300;
var TIP_GAP_PX = 8;
var tip = Object.assign(document.createElement("div"), { id: "tip", role: "tooltip" });
var tipTimer = 0;
function hideTip() {
  window.clearTimeout(tipTimer);
  tip.classList.remove("on");
}
function showTip(el) {
  tip.textContent = el.dataset.tip ?? "";
  placeTip(el);
  tip.classList.add("on");
}
function placeTip(el) {
  const r2 = el.getBoundingClientRect(), t2 = tip.getBoundingClientRect();
  const [x2, y2] = el.closest("#bottom") ? tipBesideLeftColumn(r2, t2) : tipCentredVertically(r2, t2);
  tip.style.left = `${MathUtils9.clamp(x2, TIP_GAP_PX, innerWidth - t2.width - TIP_GAP_PX)}px`;
  tip.style.top = `${MathUtils9.clamp(y2, TIP_GAP_PX, innerHeight - t2.height - TIP_GAP_PX)}px`;
}
function tipBesideLeftColumn(r2, t2) {
  return [r2.right + TIP_GAP_PX, r2.top + r2.height / 2 - t2.height / 2];
}
function tipCentredVertically(r2, t2) {
  const x2 = r2.left + r2.width / 2 - t2.width / 2;
  const y2 = r2.top < innerHeight / 2 ? r2.bottom + TIP_GAP_PX : r2.top - TIP_GAP_PX - t2.height;
  return [x2, y2];
}
function wireTooltips() {
  document.body.appendChild(tip);
  document.addEventListener("pointerover", (e3) => {
    const el = closestOf(e3.target, "[title], [data-tip]");
    if (!el || e3.pointerType === "touch") return;
    if (el.hasAttribute("title")) {
      el.dataset.tip = el.title;
      el.removeAttribute("title");
    }
    window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => showTip(el), TIP_DELAY_MS);
  });
  document.addEventListener("pointerout", (e3) => {
    if (closestOf(e3.target, "[data-tip]")) hideTip();
  });
  for (const ev of ["pointerdown", "keydown", "wheel"]) document.addEventListener(ev, hideTip, { passive: true });
}

// src/ui/live.ts
var LIVE_TOAST_MS = 3e3;
function startLive(page2) {
  disableOpenUrl();
  const banner = byId("banner");
  const errorLine = banner.querySelector(".err");
  const followLine = byId("follow-note");
  const refreshBanner = () => {
    banner.hidden = followLine.hidden && errorLine.hidden;
  };
  followNote(page2, followLine, refreshBanner);
  const renderViewItem = addRenderItem();
  const showError = (text) => {
    errorLine.textContent = text;
    errorLine.hidden = banner.hidden = false;
  };
  let renderedAt;
  const showStatus = (status) => {
    const r2 = status.render;
    renderViewItem.hidden = !r2.enabled;
    errorLine.textContent = [status.error, r2.error ? `Blender error: ${r2.error}` : ""].filter(Boolean).join("\n\n");
    errorLine.hidden = !errorLine.textContent;
    refreshBanner();
    if (r2.state === "rendering") note(`Rendering ${r2.output}\u2026`, STAY);
    else if (r2.time && r2.time !== renderedAt && renderedAt !== void 0) note(`${r2.output} updated`, LIVE_TOAST_MS);
    else if (noteText().startsWith("Rendering")) hideNote();
    renderedAt = r2.time;
  };
  const events = new EventSource("events");
  events.addEventListener("status", (e3) => {
    const status = JSON.parse(e3.data);
    showStatus(status);
    reloadLive(status.version).catch((error) => showError(String(error)));
  });
}
function disableOpenUrl() {
  const openUrl = byId("open-url");
  openUrl.disabled = true;
  openUrl.title = "Not on a gemmy serve page: it has no loader for an address (drop a file, or Open scene\u2026)";
}
function followNote(page2, followLine, refreshBanner) {
  onTabChange((source) => {
    followLine.hidden = source.kind === "live";
    if (!followLine.hidden)
      followLine.textContent = `Showing ${nameOf(source)} \u2014 choose ${page2.name} to follow the server again`;
    refreshBanner();
  });
}
function addRenderItem() {
  registerExport("render-view", async () => {
    exportMenu.hidePopover();
    try {
      const response = await fetch("render-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: settingsJson(currentView())
      });
      const reply = await response.json();
      if (response.ok) note("Render queued with this view", LIVE_TOAST_MS);
      else note(`Could not use this view: ${reply.error}`, STAY);
    } catch (error) {
      note(`Could not use this view: ${error}`, STAY);
    }
  });
  return exportMenu.querySelector('[data-export="render-view"]');
}

// src/main.ts
var embedded = document.getElementById("scene-data").textContent.trim();
var mode = document.querySelector('meta[name="gemmy-mode"]')?.content;
var page = pageName.read();
function pageSources() {
  if (embedded) return [{ kind: "embedded", doc: JSON.parse(embedded), page }];
  if (mode === "live") return [{ kind: "live", page }];
  return sourcesToOpen(location.search, location.href, defaultScenes());
}
function defaultScenes() {
  return [...document.querySelectorAll('meta[name="gemmy-default-scene"]')].map((meta) => meta.content).filter((scene2) => scene2 !== "");
}
wireStage();
wireViewButtons();
wireLensBar();
wireToolbarButtons();
wireTooltips();
wireReadout();
wirePicking(releasePivot);
wirePanels();
wireKeyboard();
wireFlyKeys();
if (mode === "live") startLive(page);
startTabs(pageSources);
attachOpeners();
