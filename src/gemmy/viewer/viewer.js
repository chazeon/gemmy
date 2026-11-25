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
      function fitCurve2(points2, maxError, progressCallback) {
        if (!Array.isArray(points2)) {
          throw new TypeError("First argument should be an array");
        }
        points2.forEach(function(point) {
          if (!Array.isArray(point) || point.some(function(item) {
            return typeof item !== "number";
          }) || point.length !== points2[0].length) {
            throw Error("Each point should be an array of numbers. Each point should have the same amount of numbers.");
          }
        });
        points2 = points2.filter(function(point, i) {
          return i === 0 || !point.every(function(val, j) {
            return val === points2[i - 1][j];
          });
        });
        if (points2.length < 2) {
          return [];
        }
        var len = points2.length;
        var leftTangent = createTangent(points2[1], points2[0]);
        var rightTangent = createTangent(points2[len - 2], points2[len - 1]);
        return fitCubic(points2, leftTangent, rightTangent, maxError, progressCallback);
      }
      function fitCubic(points2, leftTangent, rightTangent, error, progressCallback) {
        var MaxIterations = 20;
        var bezCurve, u, uPrime, maxError, prevErr, splitPoint, prevSplit, centerVector, toCenterTangent, fromCenterTangent, beziers, dist2, i;
        if (points2.length === 2) {
          dist2 = maths.vectorLen(maths.subtract(points2[0], points2[1])) / 3;
          bezCurve = [points2[0], maths.addArrays(points2[0], maths.mulItems(leftTangent, dist2)), maths.addArrays(points2[1], maths.mulItems(rightTangent, dist2)), points2[1]];
          return [bezCurve];
        }
        u = chordLengthParameterize(points2);
        var _generateAndReport = generateAndReport(points2, u, u, leftTangent, rightTangent, progressCallback);
        bezCurve = _generateAndReport[0];
        maxError = _generateAndReport[1];
        splitPoint = _generateAndReport[2];
        if (maxError === 0 || maxError < error) {
          return [bezCurve];
        }
        if (maxError < error * error) {
          uPrime = u;
          prevErr = maxError;
          prevSplit = splitPoint;
          for (i = 0; i < MaxIterations; i++) {
            uPrime = reparameterize(bezCurve, points2, uPrime);
            var _generateAndReport2 = generateAndReport(points2, u, uPrime, leftTangent, rightTangent, progressCallback);
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
        centerVector = maths.subtract(points2[splitPoint - 1], points2[splitPoint + 1]);
        if (centerVector.every(function(val) {
          return val === 0;
        })) {
          centerVector = maths.subtract(points2[splitPoint - 1], points2[splitPoint]);
          var _ref = [-centerVector[1], centerVector[0]];
          centerVector[0] = _ref[0];
          centerVector[1] = _ref[1];
        }
        toCenterTangent = maths.normalize(centerVector);
        fromCenterTangent = maths.mulItems(toCenterTangent, -1);
        beziers = beziers.concat(fitCubic(points2.slice(0, splitPoint + 1), leftTangent, toCenterTangent, error, progressCallback));
        beziers = beziers.concat(fitCubic(points2.slice(splitPoint), fromCenterTangent, rightTangent, error, progressCallback));
        return beziers;
      }
      ;
      function generateAndReport(points2, paramsOrig, paramsPrime, leftTangent, rightTangent, progressCallback) {
        var bezCurve, maxError, splitPoint;
        bezCurve = generateBezier(points2, paramsPrime, leftTangent, rightTangent, progressCallback);
        var _computeMaxError = computeMaxError(points2, bezCurve, paramsOrig);
        maxError = _computeMaxError[0];
        splitPoint = _computeMaxError[1];
        if (progressCallback) {
          progressCallback({
            bez: bezCurve,
            points: points2,
            params: paramsOrig,
            maxErr: maxError,
            maxPoint: splitPoint
          });
        }
        return [bezCurve, maxError, splitPoint];
      }
      function generateBezier(points2, parameters, leftTangent, rightTangent) {
        var bezCurve, A, a, C, X, det_C0_C1, det_C0_X, det_X_C1, alpha_l, alpha_r, epsilon, segLength, i, len, tmp, u, ux, firstPoint = points2[0], lastPoint = points2[points2.length - 1];
        bezCurve = [firstPoint, null, null, lastPoint];
        A = maths.zeros_Xx2x2(parameters.length);
        for (i = 0, len = parameters.length; i < len; i++) {
          u = parameters[i];
          ux = 1 - u;
          a = A[i];
          a[0] = maths.mulItems(leftTangent, 3 * u * (ux * ux));
          a[1] = maths.mulItems(rightTangent, 3 * ux * (u * u));
        }
        C = [[0, 0], [0, 0]];
        X = [0, 0];
        for (i = 0, len = points2.length; i < len; i++) {
          u = parameters[i];
          a = A[i];
          C[0][0] += maths.dot(a[0], a[0]);
          C[0][1] += maths.dot(a[0], a[1]);
          C[1][0] += maths.dot(a[0], a[1]);
          C[1][1] += maths.dot(a[1], a[1]);
          tmp = maths.subtract(points2[i], bezier.q([firstPoint, firstPoint, lastPoint, lastPoint], u));
          X[0] += maths.dot(a[0], tmp);
          X[1] += maths.dot(a[1], tmp);
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
      function reparameterize(bezier2, points2, parameters) {
        return parameters.map(function(p, i) {
          return newtonRaphsonRootFind(bezier2, points2[i], p);
        });
      }
      ;
      function newtonRaphsonRootFind(bez, point, u) {
        var d = maths.subtract(bezier.q(bez, u), point), qprime = bezier.qprime(bez, u), numerator = maths.mulMatrix(d, qprime), denominator = maths.sum(maths.squareItems(qprime)) + 2 * maths.mulMatrix(d, bezier.qprimeprime(bez, u));
        if (denominator === 0) {
          return u;
        } else {
          return u - numerator / denominator;
        }
      }
      ;
      function chordLengthParameterize(points2) {
        var u = [], currU, prevU, prevP;
        points2.forEach(function(p, i) {
          currU = i ? prevU + maths.vectorLen(maths.subtract(p, prevP)) : 0;
          u.push(currU);
          prevU = currU;
          prevP = p;
        });
        u = u.map(function(x) {
          return x / prevU;
        });
        return u;
      }
      ;
      function computeMaxError(points2, bez, parameters) {
        var dist2, maxDist, splitPoint, v, i, count2, point, t;
        maxDist = 0;
        splitPoint = Math.floor(points2.length / 2);
        var t_distMap = mapTtoRelativeDistances(bez, 10);
        for (i = 0, count2 = points2.length; i < count2; i++) {
          point = points2[i];
          t = find_t(bez, parameters[i], t_distMap, 10);
          v = maths.subtract(bezier.q(bez, t), point);
          dist2 = v[0] * v[0] + v[1] * v[1];
          if (dist2 > maxDist) {
            maxDist = dist2;
            splitPoint = i;
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
        for (var i = 1; i <= B_parts; i++) {
          B_t_curr = bezier.q(bez, i / B_parts);
          sumLen += maths.vectorLen(maths.subtract(B_t_curr, B_t_prev));
          B_t_dist.push(sumLen);
          B_t_prev = B_t_curr;
        }
        B_t_dist = B_t_dist.map(function(x) {
          return x / sumLen;
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
        var lenMax, lenMin, tMax, tMin, t;
        for (var i = 1; i <= B_parts; i++) {
          if (param <= t_distMap[i]) {
            tMin = (i - 1) / B_parts;
            tMax = i / B_parts;
            lenMin = t_distMap[i - 1];
            lenMax = t_distMap[i];
            t = (param - lenMin) / (lenMax - lenMin) * (tMax - tMin) + tMin;
            break;
          }
        }
        return t;
      }
      function createTangent(pointA, pointB) {
        return maths.normalize(maths.subtract(pointA, pointB));
      }
      var maths = function() {
        function maths2() {
          _classCallCheck(this, maths2);
        }
        maths2.zeros_Xx2x2 = function zeros_Xx2x2(x) {
          var zs = [];
          while (x--) {
            zs.push([0, 0]);
          }
          return zs;
        };
        maths2.mulItems = function mulItems(items, multiplier) {
          return items.map(function(x) {
            return x * multiplier;
          });
        };
        maths2.mulMatrix = function mulMatrix(m1, m2) {
          return m1.reduce(function(sum, x1, i) {
            return sum + x1 * m2[i];
          }, 0);
        };
        maths2.subtract = function subtract(arr1, arr2) {
          return arr1.map(function(x1, i) {
            return x1 - arr2[i];
          });
        };
        maths2.addArrays = function addArrays(arr1, arr2) {
          return arr1.map(function(x1, i) {
            return x1 + arr2[i];
          });
        };
        maths2.addItems = function addItems(items, addition) {
          return items.map(function(x) {
            return x + addition;
          });
        };
        maths2.sum = function sum(items) {
          return items.reduce(function(sum2, x) {
            return sum2 + x;
          });
        };
        maths2.dot = function dot(m1, m2) {
          return maths2.mulMatrix(m1, m2);
        };
        maths2.vectorLen = function vectorLen(v) {
          return Math.hypot.apply(Math, v);
        };
        maths2.divItems = function divItems(items, divisor) {
          return items.map(function(x) {
            return x / divisor;
          });
        };
        maths2.squareItems = function squareItems(items) {
          return items.map(function(x) {
            return x * x;
          });
        };
        maths2.normalize = function normalize(v) {
          return this.divItems(v, this.vectorLen(v));
        };
        return maths2;
      }();
      var bezier = function() {
        function bezier2() {
          _classCallCheck(this, bezier2);
        }
        bezier2.q = function q(ctrlPoly, t) {
          var tx = 1 - t;
          var pA = maths.mulItems(ctrlPoly[0], tx * tx * tx), pB = maths.mulItems(ctrlPoly[1], 3 * tx * tx * t), pC = maths.mulItems(ctrlPoly[2], 3 * tx * t * t), pD = maths.mulItems(ctrlPoly[3], t * t * t);
          return maths.addArrays(maths.addArrays(pA, pB), maths.addArrays(pC, pD));
        };
        bezier2.qprime = function qprime(ctrlPoly, t) {
          var tx = 1 - t;
          var pA = maths.mulItems(maths.subtract(ctrlPoly[1], ctrlPoly[0]), 3 * tx * tx), pB = maths.mulItems(maths.subtract(ctrlPoly[2], ctrlPoly[1]), 6 * tx * t), pC = maths.mulItems(maths.subtract(ctrlPoly[3], ctrlPoly[2]), 3 * t * t);
          return maths.addArrays(maths.addArrays(pA, pB), pC);
        };
        bezier2.qprimeprime = function qprimeprime(ctrlPoly, t) {
          return maths.addArrays(maths.mulItems(maths.addArrays(maths.subtract(ctrlPoly[2], maths.mulItems(ctrlPoly[1], 2)), ctrlPoly[0]), 6 * (1 - t)), maths.mulItems(maths.addArrays(maths.subtract(ctrlPoly[3], maths.mulItems(ctrlPoly[2], 2)), ctrlPoly[1]), 6 * t));
        };
        return bezier2;
      }();
      module2.exports = fitCurve2;
      module2.exports.fitCubic = fitCubic;
      module2.exports.createTangent = createTangent;
    });
  }
});

// src/config.ts
var LOOK = {
  azimuth: 35,
  elevation: 28,
  dark: 0.72,
  // brightness of the shaded band
  threshold: 0.25,
  // N.L above which a surface is lit
  key: [-0.55, 0.6, 0.6],
  // key light, screen-relative: right, up, towards the viewer
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
var GEMMY = __CONSTANTS_JSON__;
var AXIS_FONT = { family: "Gemmy Axis Labels", faces: __AXIS_FONTS_JSON__ };
var axisFontFace = (weights = Object.keys(AXIS_FONT.faces)) => weights.map((w) => `@font-face { font-family: "${AXIS_FONT.family}"; font-style: italic; font-weight: ${w}; src: url(data:font/ttf;base64,${AXIS_FONT.faces[w]}) format("truetype"); }`).join("\n");

// src/geom/vector.ts
var lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
var span = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
var vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var vscale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
var vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function vunit(a) {
  const length2 = Math.hypot(...a) || 1;
  return a.map((x) => x / length2);
}

// src/camera/framing.ts
var baseDistance = (extent3) => Math.max(GEMMY.distanceFactor * extent3, GEMMY.distanceMin);
var orthoSide = (extent3) => Math.max(GEMMY.orthoFactor * extent3, GEMMY.orthoMin);
var ORTHO_VIEW_DISTANCE = 8;
function orthoFrame(extent3, width, height) {
  const side = orthoSide(extent3);
  const larger = Math.max(width, height);
  return { halfWidth: side / 2 * (width / larger), halfHeight: side / 2 * (height / larger) };
}
var RAD_TO_DEG = 180 / Math.PI;
function fitZoomPersp(extent3, lens2, width, height) {
  const shorterSensor = GEMMY.sensorWidth * Math.min(width, height) / Math.max(width, height);
  const halfAngle = Math.atan(shorterSensor / 2 / lens2);
  return baseDistance(extent3) * Math.sin(halfAngle) / (orthoSide(extent3) / 2);
}
var fitZoom = (width, height) => Math.min(width, height) / Math.max(width, height);
var orthoToPerspZoom = (extent3, lens2, zoom2) => baseDistance(extent3) * GEMMY.sensorWidth * zoom2 / (orthoSide(extent3) * lens2);
var perspToOrthoZoom = (extent3, lens2, zoom2) => zoom2 * orthoSide(extent3) * lens2 / (baseDistance(extent3) * GEMMY.sensorWidth);
var EXPORT_LONG_SIDE = 1600;
function exportView(view) {
  const { quaternion, zoom: zoom2, target, centre: centre2, box: box2, width, height } = view;
  return {
    projection: view.projection ?? "ortho",
    lens: view.projection === "persp" ? view.lens : void 0,
    direction: applyQuaternion(quaternion, [0, 0, 1]).map((x) => roundTo(x, 4)),
    up: applyQuaternion(quaternion, [0, 1, 0]).map((x) => roundTo(x, 4)),
    zoom: roundTo(zoom2, 3),
    target: target.map((t, i) => roundTo(t + centre2[i], 4)),
    cellBox: Boolean(box2),
    resolution: resolutionFor(width, height)
  };
}
function settingsObject(view) {
  return {
    look: { preset: "3to2d" },
    camera: {
      projection: view.projection,
      ...view.lens === void 0 ? {} : { lens: view.lens },
      direction: view.direction,
      up: view.up,
      zoom: view.zoom,
      target: view.target
    },
    cell_box: { show: view.cellBox },
    quality: { resolution: view.resolution }
  };
}
var settingsJson = (view) => `${JSON.stringify(settingsObject(view), null, 2)}
`;
function settingsToml(view) {
  return Object.entries(settingsObject(view)).map(([table, keys]) => `[${table}]
${Object.entries(keys).map(([k, v]) => `${k} = ${tomlValue(v)}`).join("\n")}
`).join("\n");
}
function renderCommand(view, sceneFile) {
  const [w, h] = view.resolution;
  return [
    "gemmy render",
    "--scene",
    shellWord(sceneFile),
    "--look.preset 3to2d",
    `--camera.projection ${view.projection}`,
    ...view.lens === void 0 ? [] : [`--camera.lens ${view.lens}`],
    `--camera.direction ${view.direction.join(" ")}`,
    `--camera.up ${view.up.join(" ")}`,
    `--camera.zoom ${view.zoom}`,
    `--camera.target ${view.target.join(" ")}`,
    `--cell-box.show ${view.cellBox ? "True" : "False"}`,
    `--quality.resolution ${w} ${h}`,
    "--out view.png"
  ].join(" ");
}
function triadLayout(dirs, width, height) {
  const T = GEMMY.triad;
  const length2 = T.size * Math.min(width, height);
  const origin = [T.margin * width, height - T.margin * height];
  const items = dirs.map((d, index) => triadItem(d, index, origin, length2)).sort((p, q) => p.depth - q.depth);
  return {
    origin,
    items,
    lineWidth: 2 * T.arrowRadius * length2,
    fontSize: T.labelSize * length2,
    dotRadius: DOT_RADIUS * length2,
    length: length2
  };
}
var LABEL_FLAT_MIN = 0.15;
var HEAD_FLAT_MIN = 0.08;
var DIAGONAL = Math.SQRT1_2;
var DOT_RADIUS = 0.0875;
function triadItem(d, index, origin, length2) {
  const T = GEMMY.triad;
  const flat = Math.hypot(d[0], d[1]);
  const onScreen2 = flat > LABEL_FLAT_MIN;
  const [ux, uy] = labelDirection(d, flat, onScreen2);
  const labelRadius = length2 * (1 + T.labelReach * T.arrowRadius);
  const reach = onScreen2 ? labelRadius * flat : 0;
  const pad = T.labelPad * length2;
  const label = { x: origin[0] + (reach + pad) * ux, y: origin[1] - (reach + pad) * uy };
  return flat > HEAD_FLAT_MIN ? { index, depth: d[2], label, ...triadArrow(d, flat, origin, length2) } : { index, depth: d[2], label };
}
function labelDirection(d, flat, onScreen2) {
  return onScreen2 ? [d[0] / flat, d[1] / flat] : [DIAGONAL, DIAGONAL];
}
var SHAFT_INTO_HEAD = 0.5;
function triadArrow(d, flat, [ox, oy], length2) {
  const T = GEMMY.triad;
  const tip2 = [ox + d[0] * length2, oy - d[1] * length2];
  const tx = d[0] / flat;
  const ty = -d[1] / flat;
  const headLength = T.headLengthRatio * length2;
  const headHalf = T.headRadiusRatio * T.arrowRadius * length2;
  const base = [tip2[0] - tx * headLength, tip2[1] - ty * headLength];
  return {
    shaftEnd: [tip2[0] - tx * headLength * SHAFT_INTO_HEAD, tip2[1] - ty * headLength * SHAFT_INTO_HEAD],
    head: [
      tip2,
      [base[0] - ty * headHalf, base[1] + tx * headHalf],
      [base[0] + ty * headHalf, base[1] - tx * headHalf]
    ]
  };
}
var CAMERA_FORWARD = [0, 0, -1];
var viewForward = (quaternion) => applyQuaternion(quaternion, CAMERA_FORWARD);
var flyShift = (quaternion, distance2) => viewForward(quaternion).map((x) => x * distance2);
var centreDistance = (position) => Math.hypot(position[0], position[1], position[2]);
var pointAlong = (from, direction, distance2) => from.map((x, i) => x + direction[i] * distance2);
function pivotTarget(position, quaternion, currentTarget, hitDistance, minDistance) {
  const pivotDistance = Math.max(hitDistance, minDistance);
  const targetDistance = span(position, currentTarget);
  if (pivotDistance >= targetDistance) return null;
  return pointAlong(position, viewForward(quaternion), pivotDistance);
}
function distancesFromCentre(target, towards, wanted) {
  const alongTarget = vdot(target, towards);
  const discriminant = alongTarget * alongTarget - (vdot(target, target) - wanted * wanted);
  if (discriminant < 0) return [-alongTarget];
  const root2 = Math.sqrt(discriminant);
  return [-alongTarget - root2, -alongTarget + root2];
}
var clampTo = (x, low, high) => Math.min(Math.max(x, low), high);
function dollyPosition(position, target, wanted, minDistance, maxDistance) {
  const current4 = span(position, target);
  if (current4 === 0) return null;
  const towards = vunit(vsub(position, target));
  const ahead = distancesFromCentre(target, towards, wanted).filter((s) => s > 0);
  if (!ahead.length) return null;
  const nearest = ahead.reduce((best, s) => Math.abs(s - current4) < Math.abs(best - current4) ? s : best);
  const along = clampTo(nearest, minDistance, maxDistance);
  return target.map((x, i) => x + towards[i] * along);
}
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
function resolutionFor(width, height) {
  const scale = EXPORT_LONG_SIDE / Math.max(width, height);
  return [Math.round(width * scale), Math.round(height * scale)];
}
var roundTo = (x, digits) => {
  const scale = 10 ** digits;
  return Math.round(x * scale) / scale || 0;
};
function applyQuaternion(q, v) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
var tomlValue = (v) => Array.isArray(v) ? `[${v.map(tomlValue).join(", ")}]` : JSON.stringify(v);
var shellWord = (text) => /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;

// src/scene/bounds.ts
var MIN_EXTENT = 1;
function sceneBounds(scene2) {
  const positions = new Map(scene2.points.map((p) => [p.id, p.position]));
  const corners = [...positions.values(), ...arrowEnds(scene2, positions)];
  if (corners.length === 0) return { centre: [0, 0, 0], extent: MIN_EXTENT };
  const { lo, hi } = boundingBox(corners);
  const size = hi.map((x, i) => x - lo[i]);
  return {
    centre: lo.map((x, i) => (x + hi[i]) * 0.5),
    extent: Math.max(Math.hypot(...size), MIN_EXTENT)
  };
}
function arrowEnds(scene2, positions) {
  const ends = [];
  for (const d of scene2.primitives.displacements) {
    const atom = positions.get(d.start_point_id);
    if (atom === void 0) continue;
    const far = atom.map((x, i) => x + d.vector[i]);
    const near = atom.map((x, i) => x - d.vector[i]);
    ends.push(...d.anchor === "tip" ? [near, atom] : [atom, far]);
  }
  return ends;
}
function boundingBox(points2) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points2) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  }
  return { lo, hi };
}

// src/render/draw.ts
import * as THREE2 from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";

// src/state.ts
import * as THREE from "three";
var data = void 0;
var points = /* @__PURE__ */ new Map();
var polyhedra = [];
var centre = [0, 0, 0];
var extent = 1;
var lattice = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
var atomGroup = new THREE.Group();
var polyGroup = new THREE.Group();
var outlineGroup = new THREE.Group();
var box = null;
var polyTargets = [];
var show = { atoms: true, box: true };
var outlines = true;
var camera = void 0;
var lens = GEMMY.defaultLens;
var fitValue = 1;
var dirty = true;
function requestRender() {
  dirty = true;
}
function takeDirty() {
  const was = dirty;
  dirty = false;
  return was;
}
function setData(value) {
  data = value;
}
function setPoints(value) {
  points = value;
}
function setPolyhedra(value) {
  polyhedra = value;
}
function setCentre(value) {
  centre = value;
}
function setExtent(value) {
  extent = value;
}
function setLattice(value) {
  lattice = value;
}
function setAtomGroup(value) {
  atomGroup = value;
}
function setPolyGroup(value) {
  polyGroup = value;
}
function setOutlineGroup(value) {
  outlineGroup = value;
}
function setBox(value) {
  box = value;
}
function setPolyTargets(value) {
  polyTargets = value;
}
function setOutlines(value) {
  outlines = value;
}
function setCamera(value) {
  camera = value;
}
function setLens(value) {
  lens = value;
}
function setFitValue(value) {
  fitValue = value;
}

// src/render/draw.ts
var MAX_PIXEL_RATIO = 2;
var CLIP_NEAR = 0.1;
var CLIP_FAR = 100;
var PLACEHOLDER_FOV_DEG = 30;
var TOON_STEPS = 16;
var NUMBERS_PER_MATRIX = 16;
var OUTLINE_THICKNESS = 35e-4;
var OUTLINE_SIZE_FRACTION = 0.12;
var FACE_OFFSET_FACTOR = 1;
var FACE_OFFSET_UNITS = 1;
var ATOM_SEGMENTS = { width: 48, height: 24 };
var DOT_SEGMENTS = { width: 12, height: 8 };
var TUBE_SEGMENTS = 24;
var stage = document.getElementById("stage");
var renderer = new THREE2.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setClearColor(0, 0);
stage.appendChild(renderer.domElement);
var scene = new THREE2.Scene();
var root = new THREE2.Group();
scene.add(root);
var orthoCamera = new THREE2.OrthographicCamera(-1, 1, 1, -1, CLIP_NEAR, CLIP_FAR);
var perspCamera = new THREE2.PerspectiveCamera(PLACEHOLDER_FOV_DEG, 1, CLIP_NEAR, CLIP_FAR);
perspCamera.filmGauge = GEMMY.sensorWidth;
scene.add(orthoCamera, perspCamera);
setCamera(orthoCamera);
scene.add(new THREE2.AmbientLight(16777215, LOOK.dark * Math.PI));
var key = new THREE2.DirectionalLight(16777215, (1 - LOOK.dark) * Math.PI);
key.position.set(...LOOK.key);
camera.add(key, key.target);
var controls = new TrackballControls(camera, renderer.domElement);
var edgeMaterial = new THREE2.LineBasicMaterial({ color: srgbColor(LOOK.outline) });
var boxMaterial = new THREE2.LineBasicMaterial();
var OUTLINE_VERTEX_SHADER = `
    uniform float outlineThickness;
    uniform float outlineScale; // the user's width (ui/outline-scale.ts): 1 is the automatic width
    #define OUTLINE_SIZE_FRACTION ${OUTLINE_SIZE_FRACTION.toFixed(3)} // a float literal: GLSL reads a bare integer as int

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

    void main() {
      vec4 local = vec4(position, 1.0);
      vec3 normalLocal = normal;
      // The instance's cross-section radius: the shorter of its X and Z columns (a cylinder's axis is local Y, and
      // a sphere has equal columns). A plain mesh has no instance, so it gets no cap.
      float radius = 1e9;
      #ifdef USE_INSTANCING
        mat3 instanceRotation = mat3(instanceMatrix);
        // dividing each column by its squared length gives the inverse transpose for a scaled instance
        normalLocal = instanceRotation * (normal / vec3(dot(instanceRotation[0], instanceRotation[0]), dot(instanceRotation[1], instanceRotation[1]), dot(instanceRotation[2], instanceRotation[2])));
        local = instanceMatrix * local;
        radius = min(length(instanceRotation[0]), length(instanceRotation[2]));
      #endif
      normalLocal = normalize(normalLocal);
      vec4 clipPos = projectionMatrix * modelViewMatrix * local;
      vec4 clipPosInward = projectionMatrix * modelViewMatrix * vec4(local.xyz - normalLocal, 1.0);
      // pushed along the screen-space direction of the normal
      float width = outlineWidth(clipPos.w, radius) * outlineScale;
      gl_Position = clipPos + normalize(clipPos - clipPosInward) * width * clipPos.w;
    }`;
var OUTLINE_FRAGMENT_SHADER = `
    uniform vec3 outlineColor;
    void main() {
      gl_FragColor = vec4(outlineColor, 1.0);
      #include <colorspace_fragment>
    }`;
var outlineMaterial = new THREE2.ShaderMaterial({
  side: THREE2.BackSide,
  uniforms: {
    outlineThickness: { value: OUTLINE_THICKNESS },
    outlineScale: { value: 1 },
    // These numbers are read as linear colour (Color.fromArray) and colorspace_fragment then encodes them to sRGB, so
    // the outline shows lighter than the edges (edgeMaterial reads LOOK.outline as sRGB). Blender's Freestyle line
    // colour, set from the same numbers in renderer.py, is linear too; the render match depends on this.
    outlineColor: { value: new THREE2.Color().fromArray(LOOK.outline) }
  },
  vertexShader: OUTLINE_VERTEX_SHADER,
  fragmentShader: OUTLINE_FRAGMENT_SHADER
});
var toonGradient = makeToonGradient();
var toonMaterials = /* @__PURE__ */ new Map();
function toon(id, { faces = false, ghost = false } = {}) {
  const cacheKey = `${id}|${faces}|${ghost}`;
  if (!toonMaterials.has(cacheKey)) toonMaterials.set(cacheKey, makeToon(id, faces, ghost));
  return toonMaterials.get(cacheKey);
}
var SHAPES = {
  sphere: () => new THREE2.SphereGeometry(1, ATOM_SEGMENTS.width, ATOM_SEGMENTS.height),
  dot: () => new THREE2.SphereGeometry(1, DOT_SEGMENTS.width, DOT_SEGMENTS.height),
  cylinder: () => new THREE2.CylinderGeometry(1, 1, 1, TUBE_SEGMENTS, 1),
  cone: () => new THREE2.ConeGeometry(1, 1, TUBE_SEGMENTS, 1)
};
function instanced(geometry, material, matrices) {
  const mesh = new THREE2.InstancedMesh(geometry, material, matrices.length / NUMBERS_PER_MATRIX);
  mesh.instanceMatrix.array.set(matrices);
  mesh.frustumCulled = false;
  return mesh;
}
function setOutlineScale(scale) {
  outlineMaterial.uniforms.outlineScale.value = scale;
}
function outlineOf(mesh) {
  if (mesh instanceof THREE2.InstancedMesh) {
    const outline2 = new THREE2.InstancedMesh(mesh.geometry, outlineMaterial, mesh.count);
    outline2.instanceMatrix = mesh.instanceMatrix;
    outline2.frustumCulled = false;
    return outline2;
  }
  const outline = new THREE2.Mesh(mesh.geometry, outlineMaterial);
  outline.frustumCulled = false;
  return outline;
}
function disposeScene() {
  root.traverse((object) => {
    object.geometry?.dispose();
    if (object instanceof THREE2.InstancedMesh) object.dispose();
  });
  for (const material of toonMaterials.values()) material.dispose();
  toonMaterials = /* @__PURE__ */ new Map();
  root.clear();
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}
function srgbColor(rgb) {
  return new THREE2.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE2.SRGBColorSpace);
}
function baseColorOf(id) {
  return id === null ? ARROW.color : data.materials[id].base_color;
}
function alphaOf(id) {
  return id === null ? 1 : data.materials[id].alpha ?? 1;
}
function makeToon(id, faces, ghost) {
  const material = new THREE2.MeshToonMaterial({
    color: srgbColor(baseColorOf(id)),
    gradientMap: toonGradient,
    polygonOffset: faces,
    polygonOffsetFactor: FACE_OFFSET_FACTOR,
    polygonOffsetUnits: FACE_OFFSET_UNITS
  });
  if (ghost) {
    material.transparent = true;
    material.opacity = alphaOf(id);
    material.depthWrite = false;
  }
  return material;
}
function makeToonGradient() {
  const firstLit = Math.ceil((LOOK.threshold + 1) / 2 * TOON_STEPS);
  const texels = Array.from({ length: TOON_STEPS }, (_, i) => i >= firstLit ? 255 : 0);
  const texture = new THREE2.DataTexture(new Uint8Array(texels), TOON_STEPS, 1, THREE2.RedFormat);
  texture.minFilter = THREE2.NearestFilter;
  texture.magFilter = THREE2.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

// src/ui/ui.ts
import * as THREE13 from "three";

// src/ui/picking.ts
import * as THREE6 from "three";

// src/ui/readout.ts
import * as THREE5 from "three";

// src/camera/view.ts
import * as THREE4 from "three";

// src/camera/glide.ts
import * as THREE3 from "three";
var GLIDE_MS = 300;
var current = 0;
function glideTo(point) {
  const offset = point.clone().sub(controls.target);
  glideView(point, camera.position.clone().add(offset));
}
function glideView(target, position, zoom2) {
  const id = ++current;
  const moveTarget = target.clone().sub(controls.target);
  const movePosition = position.clone().sub(camera.position);
  const zoomStart = camera.zoom;
  const started = performance.now();
  let shareMoved = 0;
  const step = () => {
    if (id !== current) return;
    const progress = (performance.now() - started) / GLIDE_MS;
    const share = THREE3.MathUtils.smoothstep(progress, 0, 1);
    const part = share - shareMoved;
    camera.position.addScaledVector(movePosition, part);
    controls.target.addScaledVector(moveTarget, part);
    if (zoom2 !== void 0) {
      camera.zoom = progress < 1 ? camera.zoom * Math.pow(zoom2 / zoomStart, part) : zoom2;
      camera.updateProjectionMatrix();
    }
    shareMoved = share;
    requestRender();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function cancelGlide() {
  current++;
}

// src/camera/view.ts
var ZOOM_MIN = 0.05;
var ZOOM_MAX = 40;
var ORTHO_FAR_EXTENTS = 40;
var CLIP_CHANGE_TOLERANCE = 1e-6;
var isPersp = () => camera === perspCamera;
var currentZoom = () => isPersp() ? baseDistance(extent) / distance() : camera.zoom;
var shownZoom = () => isPersp() ? baseDistance(extent) / centreDistance(camera.position.toArray()) : camera.zoom;
var frameZoom = (size, width, height) => isPersp() ? fitZoomPersp(size, lens, width, height) : fitZoom(width, height) * orthoSide(extent) / orthoSide(size);
var fitFor = (width, height) => frameZoom(extent, width, height);
function setZoom(requested) {
  const zoomLevel2 = THREE4.MathUtils.clamp(requested, ZOOM_MIN, ZOOM_MAX);
  if (isPersp()) {
    const towardsCamera = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(towardsCamera, baseDistance(extent) / zoomLevel2);
  } else {
    camera.zoom = zoomLevel2;
    camera.updateProjectionMatrix();
  }
  requestRender();
}
function syncClip() {
  if (!isPersp()) return;
  const depth = depthOfCentre(camera.position.toArray(), camera.quaternion.toArray());
  const { near, far } = clipPlanesAround(depth, extent);
  if (Math.abs(camera.near - near) > CLIP_CHANGE_TOLERANCE || Math.abs(camera.far - far) > CLIP_CHANGE_TOLERANCE) {
    Object.assign(camera, { near, far });
    camera.updateProjectionMatrix();
  }
}
function viewFrom(dir, up) {
  cancelGlide();
  controls.target.set(0, 0, 0);
  const target = controls.target;
  const sizeAway = isPersp() ? baseDistance(extent) : extent * ORTHO_VIEW_DISTANCE;
  camera.position.copy(target).addScaledVector(dir.clone().normalize(), sizeAway);
  camera.up.copy(up).normalize();
  camera.lookAt(target);
  requestRender();
}
var SCREEN_AXES = {
  x: new THREE4.Vector3(1, 0, 0),
  y: new THREE4.Vector3(0, 1, 0),
  z: new THREE4.Vector3(0, 0, 1)
};
function isScreenAxis(name) {
  return name !== void 0 && Object.hasOwn(SCREEN_AXES, name);
}
function rotate(axis, degrees) {
  const world = SCREEN_AXES[axis].clone().applyQuaternion(camera.quaternion);
  const turn = new THREE4.Quaternion().setFromAxisAngle(world, THREE4.MathUtils.degToRad(degrees));
  const offset = camera.position.clone().sub(controls.target).applyQuaternion(turn);
  camera.position.copy(controls.target).add(offset);
  camera.up.applyQuaternion(turn);
  camera.lookAt(controls.target);
  requestRender();
}
function pan(dx, dy, fraction) {
  const distanceAway = visibleHeightAtTarget(camera) * fraction;
  const shift = new THREE4.Vector3(-dx, -dy, 0).multiplyScalar(distanceAway).applyQuaternion(camera.quaternion);
  camera.position.add(shift);
  controls.target.add(shift);
  requestRender();
}
function flyForward(fraction) {
  const shift = new THREE4.Vector3(...flyShift(camera.quaternion.toArray(), visibleHeightAtTarget(camera) * fraction));
  camera.position.add(shift);
  controls.target.add(shift);
  requestRender();
}
function setShownZoom(requested) {
  const wanted = THREE4.MathUtils.clamp(requested, ZOOM_MIN, ZOOM_MAX);
  if (!isPersp()) {
    setZoom(wanted);
    return;
  }
  const next = dollyPosition(
    camera.position.toArray(),
    controls.target.toArray(),
    baseDistance(extent) / wanted,
    controls.minDistance,
    controls.maxDistance
  );
  if (next) camera.position.fromArray(next);
  requestRender();
}
var zoom = (factor) => setShownZoom(shownZoom() * factor);
function framedView(centre2, size) {
  const width = stage.clientWidth, height = stage.clientHeight;
  const zoomWanted = frameZoom(size, width, height);
  if (isPersp()) {
    const towardsCamera2 = camera.position.clone().sub(controls.target).normalize();
    const distance2 = baseDistance(size) / zoomWanted;
    return { target: centre2, position: centre2.clone().addScaledVector(towardsCamera2, distance2) };
  }
  const towardsCamera = camera.position.clone().sub(controls.target);
  if (towardsCamera.lengthSq() === 0) towardsCamera.set(0, 0, 1).applyQuaternion(camera.quaternion);
  const position = centre2.clone().addScaledVector(towardsCamera.normalize(), extent * ORTHO_VIEW_DISTANCE);
  return { target: centre2, position, zoom: zoomWanted };
}
function fit() {
  cancelGlide();
  const view = framedView(new THREE4.Vector3(0, 0, 0), extent);
  controls.target.copy(view.target);
  camera.position.copy(view.position);
  if (view.zoom !== void 0) {
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
  }
  setFitValue(fitFor(stage.clientWidth, stage.clientHeight));
  requestRender();
}
function centreOn(centre2, size) {
  const view = framedView(centre2, size);
  glideView(view.target, view.position, view.zoom);
}
function distance() {
  return camera.position.distanceTo(controls.target) || baseDistance(extent);
}
function visibleHeightAtTarget(view) {
  if (view instanceof THREE4.PerspectiveCamera) {
    const halfAngle = THREE4.MathUtils.degToRad(view.fov) / 2;
    return 2 * distance() * Math.tan(halfAngle);
  }
  return (view.top - view.bottom) / view.zoom;
}

// src/ui/dom.ts
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`gemmy viewer: the page has no #${id}`);
  return element;
}
function closestOf(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}
function clamp(value, low, high) {
  return Math.max(low, Math.min(value, high));
}

// src/ui/readout.ts
var info = byId("info-body");
var ANGSTROM_DIGITS = 3;
var FRACTIONAL_DIGITS = 4;
var DELTA_SCALE = 1e4;
var COPY_FEEDBACK_MS = 1500;
var SUBSCRIPT_DIGITS = "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089";
var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function dist(a, b) {
  return new THREE5.Vector3(...a).distanceTo(new THREE5.Vector3(...b));
}
function pointOf(id) {
  const point = points.get(id);
  if (!point) throw new Error(`gemmy viewer: the scene has no point ${id}`);
  return point;
}
function fmt(x, digits = ANGSTROM_DIGITS) {
  return x.toFixed(digits);
}
function average(xs) {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
function subscripts(s) {
  return s.replace(/\d+/g, (m) => [...m].map((c) => SUBSCRIPT_DIGITS[Number(c)]).join(""));
}
function grouped(values) {
  const counts = /* @__PURE__ */ new Map();
  for (const x of values) counts.set(fmt(x), (counts.get(fmt(x)) || 0) + 1);
  return [...counts].sort((p, q) => Number(p[0]) - Number(q[0])).map(([x, n]) => n > 1 ? `${n} \xD7 ${x}` : x).join(", ");
}
function nothingSelectedHtml() {
  return `<h2>Nothing selected</h2><p class="hint">Click an atom or a polyhedron to see its distances.</p>`;
}
function polyhedronHtml(p) {
  const centre2 = pointOf(p.center_point_id);
  const bonds = p.ligand_point_ids.map((id) => dist(centre2.position, pointOf(id).position));
  const mean = average(bonds);
  const distortion = average(bonds.map((x) => ((x - mean) / mean) ** 2));
  const centreText = centre2.fractional ? `${centre2.element} at (${centre2.fractional.map((x) => fmt(x, FRACTIONAL_DIGITS)).join(", ")})` : centre2.element;
  return `<h2>${escapeHtml(subscripts(p.name ?? "Polyhedron"))}</h2><dl>
      <dt>Centre</dt><dd>${escapeHtml(centreText)}</dd>
      <dt>Bonds</dt><dd>${grouped(bonds)} \xC5</dd>
      <dt>Mean</dt><dd>${fmt(mean)} \xC5</dd>
      <dt>\u0394</dt><dd>${(distortion * DELTA_SCALE).toFixed(2)} \xD7 10\u207B\u2074</dd>
      <dt>View</dt><dd>${CENTER_BUTTON}</dd></dl>
      <p class="hint">\u0394 is the bond-length distortion, the mean of ((d \u2212 d\u0304)/d\u0304)\xB2. Fractional coordinates are in the supercell.</p>`;
}
function objectBounds(target) {
  const offset = new THREE5.Vector3(...centre);
  if (target.kind === "atom") {
    const position = new THREE5.Vector3(...pointOf(target.atom.point_id).position).sub(offset);
    return { centre: position, size: 2 * target.atom.radius };
  }
  const corners = target.poly.ligand_point_ids.map((id) => new THREE5.Vector3(...pointOf(id).position));
  const low = new THREE5.Vector3(Infinity, Infinity, Infinity), high = low.clone().multiplyScalar(-1);
  for (const c of corners) {
    low.min(c);
    high.max(c);
  }
  return { centre: low.clone().add(high).multiplyScalar(0.5).sub(offset), size: low.distanceTo(high) };
}
var CENTER_BUTTON = `<button type="button" class="copy" data-center title="Center and fit this object" aria-label="Center and fit this object"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg> Center</button>`;
function atomHtml(a) {
  const point = pointOf(a.point_id);
  const hosts = polyhedra.filter((p) => p.ligand_point_ids.includes(a.point_id));
  const neighbours = hosts.map((p) => dist(point.position, pointOf(p.center_point_id).position));
  const hostElement = hosts.length ? pointOf(hosts[0].center_point_id).element : "";
  const ref = point.ref ? `<dt>Ref</dt><dd>${escapeHtml(point.ref)} <button type="button" class="copy" data-copy="${escapeHtml(point.ref)}">Copy</button></dd>` : "";
  const fractional = point.fractional ? `<dt>Fractional</dt><dd>${point.fractional.map((x) => fmt(x, FRACTIONAL_DIGITS)).join(", ")}</dd>` : "";
  const nbrs = neighbours.length ? `<dt>${escapeHtml(hostElement)} nbrs</dt><dd>${grouped(neighbours)} \xC5</dd>` : "";
  return `<h2>${escapeHtml(point.element)} atom</h2><dl>
      ${ref}
      ${fractional}
      <dt>Cartesian</dt><dd>${point.position.map((x) => fmt(x)).join(", ")} \xC5</dd>
      ${nbrs}
      <dt>View</dt><dd>${CENTER_BUTTON}</dd></dl>
      <p class="hint">Fractional coordinates are in the supercell.</p>`;
}
var shown = null;
function describe(target) {
  shown = target;
  if (!target) info.innerHTML = nothingSelectedHtml();
  else if (target.kind === "polyhedron") info.innerHTML = polyhedronHtml(target.poly);
  else info.innerHTML = atomHtml(target.atom);
}
function copyRef(button) {
  const done = (text) => {
    button.textContent = text;
    setTimeout(() => {
      button.textContent = "Copy";
    }, COPY_FEEDBACK_MS);
  };
  try {
    navigator.clipboard.writeText(button.dataset.copy ?? "").then(() => done("Copied"), () => done("Failed"));
  } catch {
    done("Failed");
  }
}
info.addEventListener("click", (e) => {
  const button = closestOf(e.target, "button[data-copy]");
  if (button) copyRef(button);
  else if (closestOf(e.target, "button[data-center]") && shown) {
    const { centre: centre2, size } = objectBounds(shown);
    centreOn(centre2, size);
  }
});

// src/ui/panels.ts
var PHONE_MAX_WIDTH = 640;
var narrowScreen = matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
function readChoice(key2) {
  try {
    const value = localStorage.getItem(key2);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}
function saveChoice(key2, value) {
  try {
    localStorage.setItem(key2, value ? "1" : "0");
  } catch {
  }
}
var INFO_KEY = "gemmy.info-open";
var infoPanel = byId("info");
var infoButton = byId("info-button");
var infoClose = byId("info-close");
var infoChoice = readChoice(INFO_KEY);
function showInfo(open) {
  if (open && narrowScreen.matches) showViewControls(false);
  infoPanel.hidden = !open;
  infoButton.hidden = open;
  infoButton.setAttribute("aria-expanded", String(open));
}
function toggleInfo() {
  const open = infoPanel.hidden;
  showInfo(open);
  infoChoice = open;
  saveChoice(INFO_KEY, open);
  (open ? infoClose : infoButton).focus({ preventScroll: true });
}
infoButton.addEventListener("click", toggleInfo);
infoClose.addEventListener("click", toggleInfo);
var VIEW_KEY = "gemmy.view-controls-open";
var viewBar = byId("bottom");
var viewToggle = byId("view-toggle");
var viewOpen = readChoice(VIEW_KEY) ?? !narrowScreen.matches;
function showViewControls(open) {
  viewBar.classList.toggle("folded", !open);
  viewToggle.setAttribute("aria-expanded", String(open));
}
showViewControls(viewOpen);
viewToggle.addEventListener("click", () => {
  viewOpen = !viewOpen;
  if (viewOpen && narrowScreen.matches && !infoPanel.hidden) showInfo(false);
  showViewControls(viewOpen);
  saveChoice(VIEW_KEY, viewOpen);
});

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
  atomGroup.add(mesh);
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
  polyGroup.add(mesh);
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
  return polyTargets[mesh.userData.owner[face]];
}
function pickableObjects() {
  const atoms = atomGroup.visible ? atomGroup.children.filter((o) => o.userData.atoms) : [];
  const polys = polyGroup.children.filter((o) => o.isMesh && o.userData.owner);
  return [...atoms, ...polys];
}
var ray = new THREE6.Raycaster();
function hitAt(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE6.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickableObjects(), false);
  return hits.find((h) => !isGhostHit(h)) ?? hits[0] ?? null;
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
function completesDoubleClick(e) {
  const previous = lastClick;
  lastClick = { at: e.timeStamp, x: e.clientX, y: e.clientY };
  if (!previous) return false;
  const quick = e.timeStamp - previous.at <= DOUBLE_CLICK_MS;
  const near = Math.hypot(e.clientX - previous.x, e.clientY - previous.y) <= DOUBLE_CLICK_SLOP_PX;
  if (!quick || !near) return false;
  lastClick = null;
  return true;
}
renderer.domElement.addEventListener("pointerdown", (e) => {
  pressedAt = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!pressedAt) return;
  if (Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) > POINTER_SLOP_PX) return;
  const double = completesDoubleClick(e);
  const hit = hitAt(e.clientX, e.clientY);
  select(hit ? targetOf(hit) : null);
  if (hit) showInfo(true);
  if (double && hit) glideTo(hit.point);
  else if (!hit) releasePivot();
});

// src/camera/pivot.ts
function beginRotation() {
  if (!cameraInsideStructure()) return;
  const r = renderer.domElement.getBoundingClientRect();
  const hit = pickPointAt(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit) return;
  const pivot = pivotTarget(
    camera.position.toArray(),
    camera.quaternion.toArray(),
    controls.target.toArray(),
    hit.distanceTo(camera.position),
    controls.minDistance
  );
  if (!pivot) return;
  controls.target.fromArray(pivot);
  requestRender();
}
function releasePivot() {
  const position = camera.position.toArray();
  const forward = viewForward(camera.quaternion.toArray());
  const depth = depthOfCentre(position, camera.quaternion.toArray());
  const along = Math.min(Math.max(depth, controls.minDistance), controls.maxDistance);
  controls.target.fromArray(pointAlong(position, forward, along));
  requestRender();
}
function cameraInsideStructure() {
  return camera.position.length() < extent / 2;
}
var press = null;
window.addEventListener("pointerdown", (e) => {
  press = e.button === 0 && e.target === renderer.domElement ? { x: e.clientX, y: e.clientY, armed: false } : null;
}, { capture: true });
controls.addEventListener("start", () => {
  if (press) press.armed = true;
});
window.addEventListener("pointermove", (e) => {
  if (!press?.armed) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= POINTER_SLOP_PX) return;
  press.armed = false;
  beginRotation();
}, { capture: true });
for (const ending of ["pointerup", "pointercancel"]) {
  window.addEventListener(ending, () => {
    press = null;
  }, { capture: true });
}

// src/camera/fly.ts
function fly(now) {
  if (!flying.size) {
    flyLast = 0;
    return;
  }
  const seconds = flyLast ? Math.min((now - flyLast) / MS_PER_SECOND, MAX_STEP_SECONDS) : FIRST_STEP_SECONDS;
  flyLast = now;
  for (const code of flying) {
    const move = moveFor(code);
    if (move[0] === "fly") advance(move[1], seconds);
    else pan(move[1], move[2], RATE.pan * seconds);
  }
}
function advance(direction, seconds) {
  if (isPersp()) flyForward(direction * FLY_RATE * seconds);
  else zoom(RATE.zoom ** (direction * seconds));
}
var FLY = {
  KeyW: ["fly", 1],
  KeyS: ["fly", -1],
  KeyA: ["pan", 1, 0],
  KeyD: ["pan", -1, 0],
  KeyE: ["pan", 0, -1],
  KeyQ: ["pan", 0, 1]
};
var FLY_SHIFT = { KeyW: ["pan", 0, -1], KeyS: ["pan", 0, 1] };
function moveFor(code) {
  return shiftHeld && FLY_SHIFT[code] || FLY[code];
}
var flying = /* @__PURE__ */ new Set();
var flyLast = 0;
var shiftHeld = false;
function setShiftHeld(held) {
  shiftHeld = held;
}
var MS_PER_SECOND = 1e3;
var MAX_STEP_SECONDS = 0.05;
var FIRST_STEP_SECONDS = 1 / 60;
var FLY_RATE = RATE.pan;
window.addEventListener("keyup", (e) => {
  flying.delete(e.code);
  shiftHeld = e.shiftKey;
});
window.addEventListener("blur", () => {
  flying.clear();
  shiftHeld = false;
});

// src/render/triad.ts
var FONT_LOAD_PX = 16;
var AXIS_FONT_STYLE = "italic 700";
var AXIS_LETTERS = "abc";
var FULL_TURN = 2 * Math.PI;
var triadCanvas = document.getElementById("triad");
var triadContext = triadCanvas.getContext("2d");
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: axisFontFace() }));
var axisFontReady = false;
document.fonts.load(`${AXIS_FONT_STYLE} ${FONT_LOAD_PX}px "${AXIS_FONT.family}"`).finally(() => {
  axisFontReady = true;
  requestRender();
});
function drawTriad(canvas = triadCanvas, ctx = triadContext, dpr = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)) {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  sizeCanvas(canvas, width, height, dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!axisFontReady) return void 0;
  const triad = triadLayout(latticeInView(), width, height);
  ctx.lineCap = "round";
  ctx.lineWidth = triad.lineWidth;
  for (const item of triad.items) drawAxis(ctx, item, triad.origin, triad.fontSize);
  drawOrigin(ctx, triad.origin, triad.dotRadius);
  return triad;
}
function latticeInView() {
  const inverse = camera.quaternion.clone().invert();
  return lattice.map((vector2) => vector2.clone().applyQuaternion(inverse).toArray());
}
function drawAxis(ctx, item, origin, fontSize) {
  const color = LOOK.axisColors[item.index];
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (item.head && item.shaftEnd) {
    drawShaft(ctx, origin, item.shaftEnd);
    drawHead(ctx, item.head);
  }
  ctx.font = `${AXIS_FONT_STYLE} ${fontSize}px ${cssVar("--label")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(AXIS_LETTERS[item.index], item.label.x, item.label.y);
}
function drawShaft(ctx, from, to) {
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
}
function drawHead(ctx, [tip2, left, right]) {
  ctx.beginPath();
  ctx.moveTo(tip2[0], tip2[1]);
  ctx.lineTo(left[0], left[1]);
  ctx.lineTo(right[0], right[1]);
  ctx.closePath();
  ctx.fill();
}
function drawOrigin(ctx, [x, y], radius) {
  ctx.fillStyle = cssVar("--box");
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, FULL_TURN);
  ctx.fill();
}
function sizeCanvas(canvas, width, height, dpr) {
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

// src/render/loop.ts
var FIT_PERCENT = 100;
var zoomLevel = document.getElementById("zoom-level");
function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const atFit = Math.abs(shownZoom() - fitValue) < EPS;
  setFitValue(fitFor(width, height));
  fitOrthoFrustum(width, height);
  perspCamera.aspect = width / height;
  perspCamera.setFocalLength(lens);
  if (atFit) setShownZoom(fitValue);
  renderer.setSize(width, height);
  controls.handleResize();
  requestRender();
}
function fitOrthoFrustum(width, height) {
  const { halfWidth, halfHeight } = orthoFrame(extent, width, height);
  Object.assign(orthoCamera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
  orthoCamera.updateProjectionMatrix();
}
function applyTheme() {
  boxMaterial.color.set(cssVar("--box").trim());
  requestRender();
}
function frame(now = 0) {
  requestAnimationFrame(frame);
  fly(now);
  controls.update();
  if (takeDirty()) drawView();
}
function drawView() {
  syncClip();
  renderer.render(scene, camera);
  drawTriad();
  showZoomPercent();
}
function showZoomPercent() {
  const percent = Math.round(shownZoom() / fitValue * FIT_PERCENT);
  const text = Number.isFinite(percent) ? `${percent}%` : "";
  if (zoomLevel.textContent !== text) zoomLevel.textContent = text;
}
controls.addEventListener("change", requestRender);
window.addEventListener("resize", resize);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
document.fonts?.ready.then(requestRender);
applyTheme();
frame();

// src/trace/traced.ts
import * as THREE12 from "three";

// src/export/markup.ts
import { Color as Color2, LinearSRGBColorSpace, SRGBColorSpace as SRGBColorSpace2 } from "three";
var SVG_PRECISION = 100;
var escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");
var fmt2 = (x) => Number.isFinite(x) ? String(Math.round(x * SVG_PRECISION) / SVG_PRECISION || 0) : "0";
var fmtPt = (p) => `${fmt2(p[0])} ${fmt2(p[1])}`;
var pointList = (list) => list.map((p) => `${fmt2(p.x)},${fmt2(p.y)}`).join(" ");
function attrText(attrs) {
  return Object.entries(attrs).filter((entry) => entry[1] !== void 0 && entry[1] !== false).map(([name, value]) => ` ${name}="${typeof value === "number" ? fmt2(value) : escapeAttr(value)}"`).join("");
}
function el(tag, attrs, body) {
  const list = attrText(attrs);
  return body === void 0 ? `<${tag}${list}/>` : `<${tag}${list}>${body}</${tag}>`;
}
function textEl(tag, attrs, text) {
  return `<${tag}${attrText(attrs)}>${escapeText(text)}</${tag}>`;
}
function srgbHex(rgb) {
  return `#${new Color2().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace2).getHexString()}`;
}
function linearHex(rgb) {
  return `#${new Color2().setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace).getHexString()}`;
}
function shadedBand(base, darkening) {
  return `#${new Color2().setRGB(base[0], base[1], base[2], SRGBColorSpace2).multiplyScalar(darkening).getHexString()}`;
}

// src/export/shape.ts
function colorOf(o, id) {
  return o.data.materials[id].base_color.slice(0, 3);
}
function arrowColor() {
  return ARROW.color.slice(0, 3);
}

// src/export/triad.ts
import { Vector2 as Vector24 } from "three";

// src/export/view.ts
import { Quaternion as Quaternion2, Vector2 as Vector23, Vector3 as Vector34 } from "three";
var MIN_DEPTH = 1e-3;
var HORIZON_MARGIN = 1e-3;
var vec3 = (p) => new Vector34(p[0], p[1], p[2]);
function makeView(o) {
  const { width: W, height: H, zoom: zoom2 } = o;
  const orientation = new Quaternion2().fromArray(o.quaternion);
  const right = new Vector34(1, 0, 0).applyQuaternion(orientation);
  const up = new Vector34(0, 1, 0).applyQuaternion(orientation);
  const back = new Vector34(0, 0, 1).applyQuaternion(orientation);
  const offset = vec3(o.centre).add(vec3(o.target));
  const inverse = orientation.clone().invert();
  const persp = o.projection === "persp";
  const lens2 = o.lens ?? GEMMY.defaultLens;
  const eyeZ = baseDistance(o.extent) / zoom2;
  const focal = lens2 * (Math.max(W, H) / GEMMY.sensorWidth);
  const scale = W / (2 * orthoFrame(o.extent, W, H).halfWidth) * zoom2;
  const pinhole = { eyeZ, focal, W, H };
  const toCam = (p) => p.clone().sub(offset).applyQuaternion(inverse);
  const pxPerUnit = (c) => persp ? focal / Math.max(eyeZ - c.z, MIN_DEPTH) : scale;
  const toScreen = (c) => {
    const k = pxPerUnit(c);
    return new Vector23(W / 2 + c.x * k, H / 2 - c.y * k);
  };
  const depth = (c) => persp ? -Math.hypot(c.x, c.y, eyeZ - c.z) : c.z;
  const sphereImage = (c, r) => {
    if (!persp) {
      const s = toScreen(c);
      return { cx: s.x, cy: s.y, rx: r * scale, ry: r * scale, phi: 0 };
    }
    return perspectiveSphereImage(c, r, pinhole);
  };
  return { right, up, back, toCam, toScreen, depth, pxPerUnit, sphereImage };
}
function perspectiveSphereImage(c, r, pinhole) {
  const { eyeZ, focal, W, H } = pinhole;
  const t = eyeZ - c.z;
  const rho = Math.hypot(c.x, c.y);
  const dist2 = Math.hypot(rho, t);
  const theta = Math.atan2(rho, t);
  const alpha = Math.asin(Math.min(r / dist2, 1));
  if (dist2 <= r || theta + alpha >= Math.PI / 2 - HORIZON_MARGIN) return null;
  const nearEdgePx = focal * Math.tan(theta - alpha);
  const farEdgePx = focal * Math.tan(theta + alpha);
  const centreOffsetPx = (nearEdgePx + farEdgePx) / 2;
  const across = (centreOffsetPx * Math.sin(theta) + focal * Math.cos(theta)) / Math.cos(alpha);
  const dx = rho > EPS ? c.x / rho : 1;
  const dy = rho > EPS ? -c.y / rho : 0;
  return {
    cx: W / 2 + dx * centreOffsetPx,
    cy: H / 2 + dy * centreOffsetPx,
    rx: (farEdgePx - nearEdgePx) / 2,
    ry: Math.sqrt(Math.max(across * across - centreOffsetPx * centreOffsetPx - focal * focal, 0)),
    phi: Math.atan2(dy, dx)
  };
}

// src/export/triad.ts
function triadSvg(ctx) {
  const { o, view } = ctx;
  const dirs = o.lattice.map((vec) => {
    const v = vec3(vec);
    return [v.dot(view.right), v.dot(view.up), v.dot(view.back)];
  });
  const tri = triadLayout(dirs, o.width, o.height);
  const items = [];
  for (const it of tri.items) {
    const color = LOOK.axisColors[it.index];
    if (it.head) {
      items.push(el("line", { x1: tri.origin[0], y1: tri.origin[1], x2: it.shaftEnd[0], y2: it.shaftEnd[1], stroke: color, "stroke-width": tri.lineWidth }));
      items.push(el("polygon", { points: pointList(it.head.map(([x, y]) => new Vector24(x, y))), fill: color }));
    }
    items.push(textEl("text", {
      x: it.label.x,
      y: it.label.y,
      fill: color,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-family": `'${AXIS_FONT.family}', sans-serif`,
      "font-style": "italic",
      "font-weight": 700,
      "font-size": tri.fontSize
    }, "abc"[it.index]));
  }
  items.push(el("circle", { cx: tri.origin[0], cy: tri.origin[1], r: tri.dotRadius, fill: o.boxColor }));
  return el("g", { id: "triad", "stroke-linecap": "round" }, items.join(""));
}

// src/trace/curves.ts
var import_fit_curve = __toESM(require_fit_curve());
import { MathUtils as MathUtils3 } from "three";
var RESAMPLE_PX = 0.25;
var CORNER_ANGLE_DEG = 50;
var CORNER_WINDOW_PX = 1;
var WINDOW_SAMPLES = Math.max(1, Math.round(CORNER_WINDOW_PX / RESAMPLE_PX));
var FIT_ERROR_PX = 0.3;
function segmentsPath(spans) {
  return spans.map(([p, q]) => `M${fmtPt(p)}L${fmtPt(q)}`).join("");
}
function closedPath(points2) {
  return pathFrom(points2, true);
}
function fitCommands(points2) {
  return smoothPieces(points2, false).map(fitPiece).join("");
}
function pathFrom(points2, closed) {
  const pieces = smoothPieces(points2, closed);
  if (pieces.length === 0) return "";
  const [x0, y0] = pieces[0][0];
  const d = `M${fmt2(x0)} ${fmt2(y0)}${pieces.map(fitPiece).join("")}`;
  return closed ? `${d}Z` : d;
}
function smoothPieces(points2, closed) {
  const line = resample(points2, closed, RESAMPLE_PX);
  if (line.length < 2) return [];
  const corners = cornerIndices(turningAngles(line, closed), closed);
  return closed ? ringPieces(line, corners) : linePieces(line, corners);
}
function resample(points2, closed, spacing) {
  const ring = closed ? [...points2, points2[0]] : points2;
  const lengths = [0];
  for (let i = 1; i < ring.length; i++) lengths.push(lengths[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
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
    const t = Math.min(1, Math.max(0, (target - lengths[seg]) / span2));
    const a = ring[seg];
    const b = ring[seg + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
function turningAngles(line, closed) {
  const n = line.length;
  const step = WINDOW_SAMPLES;
  const turns = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const before = closed ? (i - step + n) % n : i - step;
    const after = closed ? (i + step) % n : i + step;
    if (!closed && (before < 0 || after >= n)) continue;
    const ax = line[i][0] - line[before][0];
    const ay = line[i][1] - line[before][1];
    const bx = line[after][0] - line[i][0];
    const by = line[after][1] - line[i][1];
    turns[i] = MathUtils3.radToDeg(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    turns[i] = Math.abs(turns[i]);
  }
  return turns;
}
function cornerIndices(turns, closed) {
  const n = turns.length;
  const reach = WINDOW_SAMPLES;
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (turns[i] <= CORNER_ANGLE_DEG) continue;
    let isPeak = true;
    for (let k = -reach; k <= reach && isPeak; k++) {
      if (k === 0) continue;
      const j = closed ? (i + k + n) % n : i + k;
      if (j < 0 || j >= n) continue;
      if (turns[j] > turns[i] || turns[j] === turns[i] && k < 0) isPeak = false;
    }
    if (isPeak) corners.push(i);
  }
  return corners;
}
function ringPieces(line, corners) {
  const n = line.length;
  if (corners.length === 0) return [[...line, line[0]]];
  const pieces = [];
  for (let c = 0; c < corners.length; c++) {
    const from = corners[c];
    const to = corners[(c + 1) % corners.length];
    const piece = [];
    for (let i = from; ; i = (i + 1) % n) {
      piece.push(line[i]);
      if (i === to && piece.length > 1) break;
    }
    pieces.push(piece);
  }
  return pieces;
}
function linePieces(line, corners) {
  const cuts = [0, ...corners.filter((i) => i > 0 && i < line.length - 1), line.length - 1];
  const pieces = [];
  for (let c = 0; c < cuts.length - 1; c++) pieces.push(line.slice(cuts[c], cuts[c + 1] + 1));
  return pieces;
}
function fitPiece(piece) {
  if (piece.length < 3) return piece.slice(1).map((p) => `L${fmt2(p[0])} ${fmt2(p[1])}`).join("");
  const curves = (0, import_fit_curve.default)(piece.map((p) => [p[0], p[1]]), FIT_ERROR_PX * FIT_ERROR_PX);
  return curves.map(([, c1, c2, end]) => `C${fmt2(c1[0])} ${fmt2(c1[1])} ${fmt2(c2[0])} ${fmt2(c2[1])} ${fmt2(end[0])} ${fmt2(end[1])}`).join("");
}

// src/trace/candidates.ts
import * as THREE7 from "three";

// src/trace/ellipse.ts
import { MathUtils as MathUtils4 } from "three";
var MIN_RADIUS_PX = 1e-6;
var QUARTER_TURN = Math.PI / 2;
function arcTo(e, from, to, pts) {
  const t0 = paramOf(e, from);
  let prev = t0;
  let swept = 0;
  for (const p of pts) {
    const t = paramOf(e, p);
    swept += wrapPi(t - prev);
    prev = t;
  }
  const dir = swept >= 0 ? 1 : -1;
  return arcSeries(e, t0, dir, Math.abs(swept), to);
}
function fullEllipseArcs(e, start) {
  return arcSeries(e, paramOf(e, start), 1, 2 * Math.PI, start);
}
function arcSeries(e, t0, dir, span2, end) {
  const pieces = Math.max(1, Math.ceil(span2 / QUARTER_TURN));
  const sweep = dir > 0 ? 1 : 0;
  let d = "";
  for (let k = 1; k <= pieces; k++) {
    const point = k === pieces ? end : pointAt(e, t0 + dir * span2 * k / pieces);
    d += `A${fmt2(e.rx)} ${fmt2(e.ry)} ${fmt2(MathUtils4.radToDeg(e.phi))} 0 ${sweep} ${fmtPt(point)}`;
  }
  return d;
}
function wrapPi(t) {
  return t - 2 * Math.PI * Math.round(t / (2 * Math.PI));
}
function pointAt(e, t) {
  const x = e.rx * Math.cos(t);
  const y = e.ry * Math.sin(t);
  const cos = Math.cos(e.phi);
  const sin = Math.sin(e.phi);
  return [e.cx + x * cos - y * sin, e.cy + x * sin + y * cos];
}
function paramOf(e, p) {
  const [wx, wy] = local(e, p);
  return Math.atan2(wy / Math.max(e.ry, MIN_RADIUS_PX), wx / Math.max(e.rx, MIN_RADIUS_PX));
}
function local(e, p) {
  const dx = p[0] - e.cx;
  const dy = p[1] - e.cy;
  const cos = Math.cos(e.phi);
  const sin = Math.sin(e.phi);
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}
function ellipseRms(e, pts) {
  const mean = (e.rx + e.ry) / 2;
  let sum = 0;
  for (const p of pts) {
    const [wx, wy] = local(e, p);
    const r = Math.hypot(wx / Math.max(e.rx, MIN_RADIUS_PX), wy / Math.max(e.ry, MIN_RADIUS_PX));
    sum += ((r - 1) * mean) ** 2;
  }
  return Math.sqrt(sum / pts.length);
}
function ellipseFromBasis(c, a, b) {
  const p = a[0] * a[0] + b[0] * b[0];
  const q = a[0] * a[1] + b[0] * b[1];
  const s = a[1] * a[1] + b[1] * b[1];
  const mean = (p + s) / 2;
  const spread = Math.sqrt(((p - s) / 2) ** 2 + q * q);
  return { cx: c[0], cy: c[1], rx: Math.sqrt(mean + spread), ry: Math.sqrt(Math.max(mean - spread, 0)), phi: 0.5 * Math.atan2(2 * q, p - s) };
}

// src/trace/candidates.ts
var SEGMENT_MARGIN_PX = 2;
var MIN_SPAN_PX = 1e-6;
var PARALLEL_COS = 1e-6;
var HALF_AXIS = 0.5;
function curveRms(curve, pts) {
  return curve.kind === "line" ? lineRms(curve.a, curve.b, pts) : ellipseRms(curve.e, pts);
}
function lineRms(a, b, pts) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_SPAN_PX) return Infinity;
  let sum = 0;
  for (const p of pts) {
    const along = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len;
    if (along < -SEGMENT_MARGIN_PX || along > len + SEGMENT_MARGIN_PX) return Infinity;
    const across = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
    sum += across * across;
  }
  return Math.sqrt(sum / pts.length);
}
function onLine(a, b, p) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / Math.max(dx * dx + dy * dy, MIN_SPAN_PX);
  return [a[0] + t * dx, a[1] + t * dy];
}
function sphereCurves(view, centre2, radius) {
  const image = view.sphereImage(view.toCam(centre2), radius);
  return image ? [{ kind: "ellipse", e: { cx: image.cx, cy: image.cy, rx: image.rx, ry: image.ry, phi: image.phi } }] : [];
}
function cylinderCurves(matrix, screen) {
  const col = (i) => new THREE7.Vector3(matrix[4 * i], matrix[4 * i + 1], matrix[4 * i + 2]);
  const centre2 = new THREE7.Vector3(matrix[12], matrix[13], matrix[14]);
  const axis = col(1).multiplyScalar(HALF_AXIS);
  const ends = [centre2.clone().sub(axis), centre2.clone().add(axis)];
  const caps = ends.map((end) => {
    const c = screen(end);
    const a = screen(end.clone().add(col(0)));
    const b = screen(end.clone().add(col(2)));
    return ellipseFromBasis(c, [a[0] - c[0], a[1] - c[1]], [b[0] - c[0], b[1] - c[1]]);
  });
  const pa = screen(ends[0]);
  const pb = screen(ends[1]);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const len = Math.hypot(dx, dy);
  if (len < MIN_SPAN_PX) return caps.map((e) => ({ kind: "ellipse", e }));
  const n = [-dy / len, dx / len];
  const support = (e) => Math.hypot(e.rx * Math.cos(e.phi) * n[0] + e.rx * Math.sin(e.phi) * n[1], e.ry * Math.sin(e.phi) * n[0] - e.ry * Math.cos(e.phi) * n[1]);
  const sa = support(caps[0]);
  const sb = support(caps[1]);
  const sides = [1, -1].map((side) => ({
    kind: "line",
    a: [pa[0] + side * n[0] * sa, pa[1] + side * n[1] * sa],
    b: [pb[0] + side * n[0] * sb, pb[1] + side * n[1] * sb]
  }));
  return [...caps.map((e) => ({ kind: "ellipse", e })), ...sides];
}
function edgeCurves(edges, screen) {
  return edges.map(([p, q]) => ({ kind: "line", a: screen(p), b: screen(q) }));
}
function sectionCurve(centre2, radius, face, screen) {
  const [p0, p1, p2] = face;
  const n = new THREE7.Triangle(p0, p1, p2).getNormal(new THREE7.Vector3());
  const d = n.dot(new THREE7.Vector3().subVectors(centre2, p0));
  if (Math.abs(d) >= radius) return null;
  const foot = centre2.clone().addScaledVector(n, -d);
  const rho = Math.sqrt(radius * radius - d * d);
  const u = new THREE7.Vector3().subVectors(p1, p0).normalize();
  const v = new THREE7.Vector3().crossVectors(n, u).normalize();
  const c = screen(foot);
  const a = screen(foot.clone().addScaledVector(u, rho));
  const b = screen(foot.clone().addScaledVector(v, rho));
  return { kind: "ellipse", e: ellipseFromBasis(c, [a[0] - c[0], a[1] - c[1]], [b[0] - c[0], b[1] - c[1]]) };
}
function cylinderSectionCurve(matrix, face, screen) {
  const [p0, p1, p2] = face;
  const n = new THREE7.Triangle(p0, p1, p2).getNormal(new THREE7.Vector3());
  const c = new THREE7.Vector3(matrix[12], matrix[13], matrix[14]);
  const axisFull = new THREE7.Vector3(matrix[4], matrix[5], matrix[6]);
  const radius = new THREE7.Vector3(matrix[0], matrix[1], matrix[2]).length();
  const dir = axisFull.clone().normalize();
  const cosAlpha = Math.abs(n.dot(dir));
  if (cosAlpha < PARALLEL_COS) return null;
  const t = n.dot(new THREE7.Vector3().subVectors(p0, c)) / n.dot(dir);
  const centre2 = c.clone().addScaledVector(dir, t);
  const along = dir.clone().addScaledVector(n, -dir.dot(n)).normalize();
  const across = new THREE7.Vector3().crossVectors(n, along).normalize();
  const a = screen(centre2.clone().addScaledVector(along, radius / cosAlpha));
  const b = screen(centre2.clone().addScaledVector(across, radius));
  const o = screen(centre2);
  return { kind: "ellipse", e: ellipseFromBasis(o, [a[0] - o[0], a[1] - o[1]], [b[0] - o[0], b[1] - o[1]]) };
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
  keyAt(x, y) {
    return this.read(this.keys, x, y);
  }
  shellAt(x, y) {
    return this.read(this.shell, x, y) === 1;
  }
  lineIdAt(x, y) {
    return this.read(this.lineId, x, y);
  }
  read(values, x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return values[y * this.width + x];
  }
};
var OUT_OF_RANGE = 1 << 30;
function objectBoxes(passes, count2) {
  const { keys, depth, width } = passes;
  const pixels = new Uint32Array(count2 + 1);
  const boxes = new Int32Array((count2 + 1) * 4);
  const nearest = new Float64Array(count2 + 1).fill(BACKGROUND_DEPTH);
  for (let id = 0; id <= count2; id++) boxes.set([OUT_OF_RANGE, OUT_OF_RANGE, -1, -1], 4 * id);
  for (let p = 0; p < keys.length; p++) {
    const k = keys[p];
    if (k === 0) continue;
    const id = idOf(k);
    const b = 4 * id;
    nearest[id] = Math.min(nearest[id], depth[p]);
    pixels[id]++;
    const x = p % width;
    const y = (p - x) / width;
    if (x < boxes[b]) boxes[b] = x;
    if (y < boxes[b + 1]) boxes[b + 1] = y;
    if (x > boxes[b + 2]) boxes[b + 2] = x;
    if (y > boxes[b + 3]) boxes[b + 3] = y;
  }
  return { boxes, nearest, pixels };
}
function boxOf(boxes, id) {
  return { x0: boxes[4 * id], y0: boxes[4 * id + 1], x1: boxes[4 * id + 2], y1: boxes[4 * id + 3] };
}
function keyAtCentre(passes, p) {
  return idOf(passes.keyAt(Math.floor(p.x), Math.floor(p.y)));
}

// src/trace/measure.ts
import * as THREE8 from "three";

// node_modules/d3-polygon/dist/d3-polygon.mjs
function area(polygon) {
  var i = -1, n = polygon.length, a, b = polygon[n - 1], area3 = 0;
  while (++i < n) {
    a = b;
    b = polygon[i];
    area3 += a[1] * b[0] - a[0] * b[1];
  }
  return area3 / 2;
}
function length(polygon) {
  var i = -1, n = polygon.length, b = polygon[n - 1], xa, ya, xb = b[0], yb = b[1], perimeter = 0;
  while (++i < n) {
    xa = xb;
    ya = yb;
    b = polygon[i];
    xb = b[0];
    yb = b[1];
    xa -= xb;
    ya -= yb;
    perimeter += Math.hypot(xa, ya);
  }
  return perimeter;
}

// src/trace/measure.ts
function nearestFace(faces, p, screen) {
  let best = null;
  let bestDist = Infinity;
  for (const f of faces) {
    const d = triangleDistance(p, screen(f[0]), screen(f[1]), screen(f[2]));
    if (d < bestDist) {
      bestDist = d;
      best = [f[0], f[1], f[2]];
    }
  }
  return best;
}
function triangleDistance(p, a, b, c) {
  const sign = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const s1 = sign(a, b, p);
  const s2 = sign(b, c, p);
  const s3 = sign(c, a, p);
  if (s1 >= 0 && s2 >= 0 && s3 >= 0 || s1 <= 0 && s2 <= 0 && s3 <= 0) return 0;
  return Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
}
function segmentDistance(p, a, b) {
  const point = new THREE8.Vector3(p[0], p[1], 0);
  const segment = new THREE8.Line3(new THREE8.Vector3(a[0], a[1], 0), new THREE8.Vector3(b[0], b[1], 0));
  const nearest = segment.distance() > 0 ? segment.closestPointToPoint(point, true, new THREE8.Vector3()) : segment.start;
  return nearest.distanceTo(point);
}
function ringArea(ring, scale) {
  return Math.abs(area(ring)) / (scale * scale);
}
function ringPerimeter(ring, scale) {
  return length(ring) / scale;
}

// src/trace/edges.ts
import * as THREE9 from "three";
var HARD_EDGE_DEG = 1;
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
  spansOf(a, b, id) {
    const pa = this.project(a);
    const pb = this.project(b);
    if (!onScreen(pa) || !onScreen(pb)) return [];
    const outputLength = Math.hypot(pb.x - pa.x, pb.y - pa.y) / this.scale;
    const sampleLimit = MAX_SAMPLES_PER_IMAGE_EDGE * (this.passes.width + this.passes.height) / SAMPLE_SPACING_PX;
    const count2 = Math.min(sampleLimit, Math.max(1, Math.ceil(outputLength / SAMPLE_SPACING_PX)));
    const visible = (k) => {
      const p = this.project(a.clone().lerp(b, k / count2));
      return this.shows(id, Math.floor(p.x), Math.floor(p.y));
    };
    return runsWhere(count2, visible).map(([first, last]) => [this.cssAt(a, b, first / count2), this.cssAt(a, b, last / count2)]);
  }
  // Whether any pixel of the 3x3 block around (x, y) shows line `id`.
  shows(id, x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.passes.lineIdAt(x + dx, y + dy) === id) return true;
      }
    }
    return false;
  }
  cssAt(a, b, t) {
    const p = this.project(a.clone().lerp(b, t));
    return [p.x / this.scale, p.y / this.scale];
  }
};
function onScreen(p) {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.depth >= NDC_DEPTH_MIN && p.depth <= NDC_DEPTH_MAX;
}
function hardEdges(topo, points2) {
  const v = topo.point_ids.map((id) => new THREE9.Vector3(...points2.get(id)));
  const normals = topo.faces.map(([i, j, k]) => new THREE9.Triangle(v[i], v[j], v[k]).getNormal(new THREE9.Vector3()));
  const sides = /* @__PURE__ */ new Map();
  topo.faces.forEach(([i, j, k], f) => {
    for (const [p, q] of [[i, j], [j, k], [k, i]]) {
      const key2 = p < q ? `${p}-${q}` : `${q}-${p}`;
      if (!sides.has(key2)) sides.set(key2, { i: p, j: q, faces: [] });
      sides.get(key2).faces.push(normals[f]);
    }
  });
  const hardEdgeCosine = Math.cos(THREE9.MathUtils.degToRad(HARD_EDGE_DEG));
  const edges = [];
  for (const side of sides.values()) {
    const hard = side.faces.length === 1 || Math.abs(side.faces[0].dot(side.faces[1])) < hardEdgeCosine;
    if (hard) edges.push([v[side.i], v[side.j]]);
  }
  return edges;
}
function cellEdges(cell) {
  const [a, b, c] = cell.vectors.map((vec) => new THREE9.Vector3(...vec));
  const origin = new THREE9.Vector3(...cell.origin);
  const corner = (n) => origin.clone().addScaledVector(a, n & 1).addScaledVector(b, n >> 1 & 1).addScaledVector(c, n >> 2 & 1);
  const edges = [];
  for (let n = 0; n < 8; n++) {
    for (let axis = 0; axis < 3; axis++) {
      const bit = 1 << axis;
      if (n & bit) continue;
      edges.push([corner(n), corner(n | bit)]);
    }
  }
  return edges;
}

// node_modules/d3-array/dist/d3-array.mjs
function ascending(a, b) {
  return a == null || b == null ? NaN : a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
}
function descending(a, b) {
  return a == null || b == null ? NaN : b < a ? -1 : b > a ? 1 : b >= a ? 0 : NaN;
}
function bisector(f) {
  let compare1, compare2, delta;
  if (f.length !== 2) {
    compare1 = ascending;
    compare2 = (d, x) => ascending(f(d), x);
    delta = (d, x) => f(d) - x;
  } else {
    compare1 = f === ascending || f === descending ? f : zero;
    compare2 = f;
    delta = f;
  }
  function left(a, x, lo = 0, hi = a.length) {
    if (lo < hi) {
      if (compare1(x, x) !== 0) return hi;
      do {
        const mid = lo + hi >>> 1;
        if (compare2(a[mid], x) < 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  }
  function right(a, x, lo = 0, hi = a.length) {
    if (lo < hi) {
      if (compare1(x, x) !== 0) return hi;
      do {
        const mid = lo + hi >>> 1;
        if (compare2(a[mid], x) <= 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  }
  function center(a, x, lo = 0, hi = a.length) {
    const i = left(a, x, lo, hi - 1);
    return i > lo && delta(a[i - 1], x) > -delta(a[i], x) ? i - 1 : i;
  }
  return { left, center, right };
}
function zero() {
  return 0;
}
function number(x) {
  return x === null ? NaN : +x;
}
var ascendingBisect = bisector(ascending);
var bisectRight = ascendingBisect.right;
var bisectLeft = ascendingBisect.left;
var bisectCenter = bisector(number).center;
var blur2 = Blur2(blurf);
var blurImage = Blur2(blurfImage);
function Blur2(blur) {
  return function(data2, rx, ry = rx) {
    if (!((rx = +rx) >= 0)) throw new RangeError("invalid rx");
    if (!((ry = +ry) >= 0)) throw new RangeError("invalid ry");
    let { data: values, width, height } = data2;
    if (!((width = Math.floor(width)) >= 0)) throw new RangeError("invalid width");
    if (!((height = Math.floor(height !== void 0 ? height : values.length / width)) >= 0)) throw new RangeError("invalid height");
    if (!width || !height || !rx && !ry) return data2;
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
    return data2;
  };
}
function blurh(blur, T, S, w, h) {
  for (let y = 0, n = w * h; y < n; ) {
    blur(T, S, y, y += w, 1);
  }
}
function blurv(blur, T, S, w, h) {
  for (let x = 0, n = w * h; x < w; ++x) {
    blur(T, S, x, x + n, w);
  }
}
function blurfImage(radius) {
  const blur = blurf(radius);
  return (T, S, start, stop, step) => {
    start <<= 2, stop <<= 2, step <<= 2;
    blur(T, S, start + 0, stop + 0, step);
    blur(T, S, start + 1, stop + 1, step);
    blur(T, S, start + 2, stop + 2, step);
    blur(T, S, start + 3, stop + 3, step);
  };
}
function blurf(radius) {
  const radius0 = Math.floor(radius);
  if (radius0 === radius) return bluri(radius);
  const t = radius - radius0;
  const w = 2 * radius + 1;
  return (T, S, start, stop, step) => {
    if (!((stop -= step) >= start)) return;
    let sum = radius0 * S[start];
    const s0 = step * radius0;
    const s1 = s0 + step;
    for (let i = start, j = start + s0; i < j; i += step) {
      sum += S[Math.min(stop, i)];
    }
    for (let i = start, j = stop; i <= j; i += step) {
      sum += S[Math.min(stop, i + s0)];
      T[i] = (sum + t * (S[Math.max(start, i - s1)] + S[Math.min(stop, i + s1)])) / w;
      sum -= S[Math.max(start, i - s0)];
    }
  };
}
function bluri(radius) {
  const w = 2 * radius + 1;
  return (T, S, start, stop, step) => {
    if (!((stop -= step) >= start)) return;
    let sum = radius * S[start];
    const s = step * radius;
    for (let i = start, j = start + s; i < j; i += step) {
      sum += S[Math.min(stop, i)];
    }
    for (let i = start, j = stop; i <= j; i += step) {
      sum += S[Math.min(stop, i + s)];
      T[i] = sum / w;
      sum -= S[Math.max(start, i - s)];
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
function extent2(values, valueof) {
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
  const n = i2 - i1 + 1, ticks2 = new Array(n);
  if (reverse) {
    if (inc < 0) for (let i = 0; i < n; ++i) ticks2[i] = (i2 - i) / -inc;
    else for (let i = 0; i < n; ++i) ticks2[i] = (i2 - i) * inc;
  } else {
    if (inc < 0) for (let i = 0; i < n; ++i) ticks2[i] = (i1 + i) / -inc;
    else for (let i = 0; i < n; ++i) ticks2[i] = (i1 + i) * inc;
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
      const i = Math.ceil(start / step);
      const j = Math.floor(stop / step);
      start = (i - (i * step > start)) * step;
      stop = (j + (j * step < stop)) * step;
    } else if (step < 0) {
      const s = -step;
      const i = Math.ceil(start * s);
      const j = Math.floor(stop * s);
      start = (i - (i / s > start)) / s;
      stop = (j + (j / s < stop)) / s;
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
    let m = i1 - (i0 = +i0);
    while (m) {
      const i = random() * m-- | 0, t = array3[m + i0];
      array3[m + i0] = array3[i + i0];
      array3[i + i0] = t;
    }
    return array3;
  };
}

// node_modules/d3-contour/dist/d3-contour.mjs
var array2 = Array.prototype;
var slice2 = array2.slice;
function ascending2(a, b) {
  return a - b;
}
function area2(ring) {
  var i = 0, n = ring.length, area3 = ring[n - 1][1] * ring[0][0] - ring[n - 1][0] * ring[0][1];
  while (++i < n) area3 += ring[i - 1][1] * ring[i][0] - ring[i - 1][0] * ring[i][1];
  return area3;
}
var constant = (x) => () => x;
function contains(ring, hole) {
  var i = -1, n = hole.length, c;
  while (++i < n) if (c = ringContains(ring, hole[i])) return c;
  return 0;
}
function ringContains(ring, point) {
  var x = point[0], y = point[1], contains2 = -1;
  for (var i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    var pi = ring[i], xi = pi[0], yi = pi[1], pj = ring[j], xj = pj[0], yj = pj[1];
    if (segmentContains(pi, pj, point)) return 0;
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) contains2 = -contains2;
  }
  return contains2;
}
function segmentContains(a, b, c) {
  var i;
  return collinear(a, b, c) && within(a[i = +(a[0] === b[0])], c[i], b[i]);
}
function collinear(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) === (c[0] - a[0]) * (b[1] - a[1]);
}
function within(p, q, r) {
  return p <= q && q <= r || r <= q && q <= p;
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
      const e = extent2(values, finite);
      tz = ticks(...nice(e[0], e[1], tz), tz);
      while (tz[tz.length - 1] >= e[1]) tz.pop();
      while (tz[1] < e[0]) tz.shift();
    } else {
      tz = tz.slice().sort(ascending2);
    }
    return tz.map((value) => contour(values, value));
  }
  function contour(values, value) {
    const v = value == null ? NaN : +value;
    if (isNaN(v)) throw new Error(`invalid value: ${value}`);
    var polygons = [], holes = [];
    isorings(values, v, function(ring) {
      smooth(ring, values, v);
      if (area2(ring) > 0) polygons.push([ring]);
      else holes.push(ring);
    });
    holes.forEach(function(hole) {
      for (var i = 0, n = polygons.length, polygon; i < n; ++i) {
        if (contains((polygon = polygons[i])[0], hole) !== -1) {
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
    var fragmentByStart = new Array(), fragmentByEnd = new Array(), x, y, t0, t1, t2, t3;
    x = y = -1;
    t1 = above(values[0], value);
    cases[t1 << 1].forEach(stitch);
    while (++x < dx - 1) {
      t0 = t1, t1 = above(values[x + 1], value);
      cases[t0 | t1 << 1].forEach(stitch);
    }
    cases[t1 << 0].forEach(stitch);
    while (++y < dy - 1) {
      x = -1;
      t1 = above(values[y * dx + dx], value);
      t2 = above(values[y * dx], value);
      cases[t1 << 1 | t2 << 2].forEach(stitch);
      while (++x < dx - 1) {
        t0 = t1, t1 = above(values[y * dx + dx + x + 1], value);
        t3 = t2, t2 = above(values[y * dx + x + 1], value);
        cases[t0 | t1 << 1 | t2 << 2 | t3 << 3].forEach(stitch);
      }
      cases[t1 | t2 << 3].forEach(stitch);
    }
    x = -1;
    t2 = values[y * dx] >= value;
    cases[t2 << 2].forEach(stitch);
    while (++x < dx - 1) {
      t3 = t2, t2 = above(values[y * dx + x + 1], value);
      cases[t2 << 2 | t3 << 3].forEach(stitch);
    }
    cases[t2 << 3].forEach(stitch);
    function stitch(line) {
      var start = [line[0][0] + x, line[0][1] + y], end = [line[1][0] + x, line[1][1] + y], startIndex = index(start), endIndex = index(end), f, g;
      if (f = fragmentByEnd[startIndex]) {
        if (g = fragmentByStart[endIndex]) {
          delete fragmentByEnd[f.end];
          delete fragmentByStart[g.start];
          if (f === g) {
            f.ring.push(end);
            callback(f.ring);
          } else {
            fragmentByStart[f.start] = fragmentByEnd[g.end] = { start: f.start, end: g.end, ring: f.ring.concat(g.ring) };
          }
        } else {
          delete fragmentByEnd[f.end];
          f.ring.push(end);
          fragmentByEnd[f.end = endIndex] = f;
        }
      } else if (f = fragmentByStart[endIndex]) {
        if (g = fragmentByEnd[startIndex]) {
          delete fragmentByStart[f.start];
          delete fragmentByEnd[g.end];
          if (f === g) {
            f.ring.push(end);
            callback(f.ring);
          } else {
            fragmentByStart[g.start] = fragmentByEnd[f.end] = { start: g.start, end: f.end, ring: g.ring.concat(f.ring) };
          }
        } else {
          delete fragmentByStart[f.start];
          f.ring.unshift(start);
          fragmentByStart[f.start = startIndex] = f;
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
      var x = point[0], y = point[1], xt = x | 0, yt = y | 0, v1 = valid(values[yt * dx + xt]);
      if (x > 0 && x < dx && xt === x) {
        point[0] = smooth1(x, valid(values[yt * dx + xt - 1]), v1, value);
      }
      if (y > 0 && y < dy && yt === y) {
        point[1] = smooth1(y, valid(values[(yt - 1) * dx + xt]), v1, value);
      }
    });
  }
  contours.contour = contour;
  contours.size = function(_) {
    if (!arguments.length) return [dx, dy];
    var _0 = Math.floor(_[0]), _1 = Math.floor(_[1]);
    if (!(_0 >= 0 && _1 >= 0)) throw new Error("invalid size");
    return dx = _0, dy = _1, contours;
  };
  contours.thresholds = function(_) {
    return arguments.length ? (threshold = typeof _ === "function" ? _ : Array.isArray(_) ? constant(slice2.call(_)) : constant(_), contours) : threshold;
  };
  contours.smooth = function(_) {
    return arguments.length ? (smooth = _ ? smoothLinear : noop, contours) : smooth === smoothLinear;
  };
  return contours;
}
function finite(x) {
  return isFinite(x) ? x : NaN;
}
function above(x, value) {
  return x == null ? false : +x >= value;
}
function valid(v) {
  return v == null || isNaN(v = +v) ? -Infinity : v;
}
function smooth1(x, v0, v1, value) {
  const a = value - v0;
  const b = v1 - v0;
  const d = isFinite(a) || isFinite(b) ? a / b : Math.sign(a) / Math.sign(b);
  return isNaN(d) ? x : x + d - 0.5;
}

// src/trace/field.ts
var FIELD_RADIUS_PX = 1;
var FIELD_BORDER_PX = 2;
var ISO_LEVEL = 0.5;
function regionRings(passes, box2, match) {
  if (box2.x1 < box2.x0) return [];
  const cols = box2.x1 - box2.x0 + 1 + 2 * FIELD_BORDER_PX;
  const rows = box2.y1 - box2.y0 + 1 + 2 * FIELD_BORDER_PX;
  const mask = new Float64Array(cols * rows);
  for (let y = box2.y0; y <= box2.y1; y++) {
    for (let x = box2.x0; x <= box2.x1; x++) {
      if (match(passes.keys[y * passes.width + x])) mask[(y - box2.y0 + FIELD_BORDER_PX) * cols + (x - box2.x0 + FIELD_BORDER_PX)] = 1;
    }
  }
  const field = boxBlur(boxBlur(mask, cols, rows, FIELD_RADIUS_PX, true), cols, rows, FIELD_RADIUS_PX, false);
  const multi = Contours().size([cols, rows]).thresholds([ISO_LEVEL])(Array.from(field))[0];
  const offsetX = box2.x0 - FIELD_BORDER_PX + 0.5;
  const offsetY = box2.y0 - FIELD_BORDER_PX + 0.5;
  const rings = [];
  for (const polygon of multi.coordinates) {
    for (const ring of polygon) {
      const points2 = ring.slice(0, -1).map(([gx, gy]) => [gx + offsetX, gy + offsetY]);
      if (points2.length >= 3) rings.push(points2);
    }
  }
  return rings;
}
function boxBlur(src, cols, rows, radius, horizontal) {
  const out = new Float64Array(cols * rows);
  const weight = 1 / (2 * radius + 1);
  const length2 = horizontal ? cols : rows;
  for (let line = 0; line < (horizontal ? rows : cols); line++) {
    for (let i = 0; i < length2; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = Math.min(length2 - 1, Math.max(0, i + k));
        sum += horizontal ? src[line * cols + j] : src[j * cols + line];
      }
      if (horizontal) out[line * cols + i] = sum * weight;
      else out[i * cols + line] = sum * weight;
    }
  }
  return out;
}

// src/trace/objects.ts
import * as THREE10 from "three";

// src/geom/dashes.ts
function dashSegments(a, b, dash, gap) {
  const len = span(a, b);
  if (len <= EPS) return [];
  const count2 = Math.max(1, Math.round((len + gap) / (dash + gap)));
  const stretch = len / (count2 * dash + (count2 - 1) * gap);
  const dashFraction = dash * stretch / len;
  const periodFraction = (dash + gap) * stretch / len;
  return Array.from({ length: count2 }, (_, i) => [
    lerp(a, b, i * periodFraction),
    lerp(a, b, i * periodFraction + dashFraction)
  ]);
}
function dotCentres(a, b, spacing) {
  const len = span(a, b);
  if (len <= EPS) return [];
  const count2 = Math.max(1, Math.round(len / spacing));
  return Array.from({ length: count2 }, (_, i) => lerp(a, b, (i + 0.5) / count2));
}

// src/render/instancing.ts
var HEAD_MIN_RADII = 3;
var HEAD_MAX_SHARE = 0.8;
var SHAFT_MIN_SHARE = 0.2;
var HEAD_CENTRE_SHARE = 0.5;
var LINE_RADIUS_SHARE = 0.7;
var HARD_EDGE_ANGLE_DEG = 1;
function instanceGroups(data2) {
  const pos = pointPositions(data2);
  const groups = /* @__PURE__ */ new Map();
  const { atoms, bonds = [], displacements = [] } = data2.primitives;
  for (const atom of atoms) {
    addInstance(groups, "sphere", atom.material_id, true, sphereMatrix(pos.get(atom.point_id), atom.radius), atom);
  }
  for (const bond of bonds) addBond(groups, bond, pos);
  for (const d of displacements) addDisplacement(groups, d, pos);
  return [...groups.values()];
}
function polyhedronGroups(data2) {
  const pos = pointPositions(data2);
  const topologies = new Map(data2.topologies.map((t) => [t.id, t]));
  const groups = /* @__PURE__ */ new Map();
  data2.primitives.polyhedra.forEach((poly, index) => {
    const topo = topologies.get(poly.topology_id);
    const v = topo.point_ids.map((id) => pos.get(id));
    const group = polyhedronGroupFor(groups, poly.material_id);
    const first = group.owner.length;
    const faces = outwardFaces(v, topo.faces);
    addFaces(group, faces, v, index);
    addHardEdges(group, faces, v);
    group.ranges.push([index, first, faces.length]);
  });
  return [...groups.values()];
}
function addBond(groups, bond, pos) {
  const a = pos.get(bond.a_point_id);
  const b = pos.get(bond.b_point_id);
  const style = bond.style ?? "solid";
  if (style === "dashed") addDashes(groups, a, b, bond.radius, bond.material_id);
  else if (style === "dotted") addDots(groups, a, b, bond.radius, bond.material_id);
  else addCylinder(groups, a, b, bond.radius, bond.material_id, true);
}
function addDashes(groups, a, b, radius, material) {
  const dash = Math.max(DASH.length * radius, DASH.min);
  const gap = dash * DASH.gap / DASH.length;
  for (const [start, end] of dashSegments(a, b, dash, gap)) addCylinder(groups, start, end, radius, material, false);
}
function addDots(groups, a, b, radius, material) {
  const spacing = Math.max(DOT.spacing * radius, DOT.spacingMin);
  for (const centre2 of dotCentres(a, b, spacing)) {
    addInstance(groups, "dot", material, false, sphereMatrix(centre2, DOT.radius * radius));
  }
}
function addDisplacement(groups, d, pos) {
  const start = pos.get(d.start_point_id);
  const vector2 = d.vector;
  const atomIsTip = d.anchor === "tip";
  const tail = atomIsTip ? vsub(start, vector2) : start;
  const tip2 = atomIsTip ? start : start.map((x, i) => x + vector2[i]);
  const drawnAsArrow = (d.mode ?? "arrow").toLowerCase() === "arrow";
  const radius = ARROW.radius;
  if (drawnAsArrow) addArrow(groups, tail, tip2, radius);
  else addCylinder(groups, tail, tip2, radius * LINE_RADIUS_SHARE, null, true);
}
function addArrow(groups, a, b, radius) {
  const len = span(a, b);
  if (len <= EPS) return;
  const dir = vunit(vsub(b, a));
  const headLen = Math.min(Math.max(len * ARROW.headLengthRatio, radius * HEAD_MIN_RADII), len * HEAD_MAX_SHARE);
  const shaftLen = Math.max(len - headLen, len * SHAFT_MIN_SHARE);
  const shaftEnd = a.map((x, i) => x + dir[i] * shaftLen);
  addCylinder(groups, a, shaftEnd, radius, null, true);
  const headCentre = shaftEnd.map((x, i) => x + dir[i] * headLen * HEAD_CENTRE_SHARE);
  addInstance(groups, "cone", null, true, alongMatrix(headCentre, dir, radius * ARROW.headRadiusRatio, headLen));
}
function addCylinder(groups, a, b, radius, material, outlined) {
  const len = span(a, b);
  if (len <= EPS) return;
  const dir = vunit(vsub(b, a));
  const midpoint = lerp(a, b, 0.5);
  addInstance(groups, "cylinder", material, outlined, alongMatrix(midpoint, dir, radius, len));
}
function addInstance(groups, shape, material, outlined, matrix, ref = null) {
  const key2 = `${shape}|${material}|${outlined}`;
  let group = groups.get(key2);
  if (!group) {
    group = { shape, material, outlined, matrices: [], refs: [] };
    groups.set(key2, group);
  }
  group.matrices.push(...matrix);
  group.refs.push(ref);
}
function polyhedronGroupFor(groups, material) {
  let group = groups.get(material);
  if (!group) {
    group = { material, positions: [], edges: [], owner: [], ranges: [] };
    groups.set(material, group);
  }
  return group;
}
function outwardFaces(v, triangles) {
  const mid = centroid(v);
  return triangles.map(([i, j, k]) => {
    const n = vunit(vcross(vsub(v[j], v[i]), vsub(v[k], v[i])));
    const faceCentre = centroid([v[i], v[j], v[k]]);
    const outward = vdot(n, vsub(faceCentre, mid)) >= 0;
    return outward ? { idx: [i, j, k], n } : { idx: [i, k, j], n: n.map((x) => -x) };
  });
}
function centroid(v) {
  return v.reduce((sum, p) => sum.map((c, i) => c + p[i] / v.length), [0, 0, 0]);
}
function addFaces(group, faces, v, index) {
  for (const f of faces) {
    group.positions.push(...v[f.idx[0]], ...v[f.idx[1]], ...v[f.idx[2]]);
    group.owner.push(index);
  }
}
function addHardEdges(group, faces, v) {
  const sides = /* @__PURE__ */ new Map();
  for (const f of faces) {
    for (let e = 0; e < 3; e++) {
      const i = f.idx[e];
      const j = f.idx[(e + 1) % 3];
      const key2 = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!sides.has(key2)) sides.set(key2, { i, j, faces: [] });
      sides.get(key2).faces.push(f);
    }
  }
  const sharpAngle = Math.cos(HARD_EDGE_ANGLE_DEG * Math.PI / 180);
  for (const side of sides.values()) {
    const boundary = side.faces.length === 1;
    const sharp = !boundary && vdot(side.faces[0].n, side.faces[1].n) < sharpAngle;
    if (boundary || sharp) group.edges.push(...v[side.i], ...v[side.j]);
  }
}
function pointPositions(data2) {
  return new Map(data2.points.map((p) => [p.id, p.position]));
}
function sphereMatrix(c, r) {
  return [r, 0, 0, 0, 0, r, 0, 0, 0, 0, r, 0, c[0], c[1], c[2], 1];
}
function alongMatrix(centre2, d, radius, length2) {
  const { x, z } = rotationFromY(d);
  return [
    x[0] * radius,
    x[1] * radius,
    x[2] * radius,
    0,
    d[0] * length2,
    d[1] * length2,
    d[2] * length2,
    0,
    z[0] * radius,
    z[1] * radius,
    z[2] * radius,
    0,
    centre2[0],
    centre2[1],
    centre2[2],
    1
  ];
}
function rotationFromY(d) {
  const axisX = d[2];
  const axisZ = -d[0];
  const cosAngle = d[1];
  if (cosAngle <= -1 + EPS) return { x: [1, 0, 0], z: [0, 0, -1] };
  const k = 1 / (1 + cosAngle);
  return {
    x: [1 - k * axisZ * axisZ, -d[0], k * axisX * axisZ],
    z: [k * axisX * axisZ, -d[2], 1 - k * axisX * axisX]
  };
}

// src/trace/objects.ts
var roleOf = (mesh) => mesh.userData;
function buildIdMeshes(data2, material, keep = () => true) {
  const objects = [];
  const parts = { meshes: [], shells: [], thin: [] };
  for (const group of instanceGroups(data2)) addInstanceGroup(group, objects, parts, material, keep);
  addPolyhedra(data2, objects, parts, material);
  return { objects, ...parts };
}
function addInstanceGroup(group, objects, parts, material, keep) {
  const first = objects.length + 1;
  const kept = [];
  const dropped = [];
  group.refs.forEach((_, i) => {
    const obj = { kind: group.shape, material: group.material, alpha: 1, outlined: group.outlined, centre: instanceCentre(group.matrices, i), matrix: group.matrices.slice(16 * i, 16 * i + 16) };
    objects.push(obj);
    (keep(obj) ? kept : dropped).push(i);
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
function addPolyhedra(data2, objects, parts, material) {
  const points2 = new Map(data2.points.map((p) => [p.id, p.position]));
  const polyBase = objects.length;
  data2.primitives.polyhedra.forEach((poly, index) => {
    const alpha = data2.materials[poly.material_id].alpha ?? 1;
    objects.push({
      kind: "polyhedron",
      material: poly.material_id,
      alpha,
      outlined: alpha >= 1,
      centre: points2.get(poly.center_point_id),
      poly: index
    });
  });
  for (const group of polyhedronGroups(data2)) {
    const ids = new Float32Array(group.owner.length * 3);
    group.owner.forEach((p, t) => ids.fill(polyBase + p + 1, t * 3, t * 3 + 3));
    const geometry = new THREE10.BufferGeometry();
    geometry.setAttribute("position", new THREE10.Float32BufferAttribute(group.positions, 3));
    geometry.setAttribute("objectId", new THREE10.BufferAttribute(ids, 1));
    geometry.computeVertexNormals();
    const mesh = new THREE10.Mesh(geometry, material);
    mesh.userData = { shape: "polyhedron", role: "solid" };
    parts.meshes.push(mesh);
    if (group.material && (data2.materials[group.material].alpha ?? 1) >= 1) {
      const shell = new THREE10.Mesh(geometry, material);
      shell.userData = { shape: "polyhedron", role: "shell" };
      parts.shells.push(shell);
    }
  }
}
function instanceCentre(matrices, i) {
  return [matrices[16 * i + 12], matrices[16 * i + 13], matrices[16 * i + 14]];
}
function instanceSet(group, first, indices, material) {
  const ids = new Float32Array(indices.length);
  indices.forEach((i, k) => ids[k] = first + i);
  const matrices = indices.flatMap((i) => group.matrices.slice(16 * i, 16 * i + 16));
  const geometry = SHAPES[group.shape]();
  geometry.setAttribute("objectId", new THREE10.InstancedBufferAttribute(ids, 1));
  return instanced(geometry, material, matrices);
}

// src/trace/passes.ts
import * as THREE11 from "three";
var TOON_STEPS2 = 16;
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
var FIRST_LIT = Math.ceil((LOOK.threshold + 1) / 2 * TOON_STEPS2);
var LIT_CUT = 2 * FIRST_LIT / TOON_STEPS2 - 1;
var FACE_OFFSET_FACTOR2 = 1;
var FACE_OFFSET_UNITS2 = 1;
function passMaterial(pass, faces) {
  const offset = faces ? { polygonOffset: true, polygonOffsetFactor: FACE_OFFSET_FACTOR2, polygonOffsetUnits: FACE_OFFSET_UNITS2 } : {};
  switch (pass) {
    case "id":
      return new THREE11.ShaderMaterial({ vertexShader: ID_VERTEX, fragmentShader: ID_FRAGMENT, ...offset });
    case "band":
      return new THREE11.ShaderMaterial({
        vertexShader: BAND_VERTEX,
        fragmentShader: BAND_FRAGMENT,
        uniforms: { lightDir: { value: new THREE11.Vector3(...LOOK.key).normalize() }, litCut: { value: LIT_CUT } },
        ...offset
      });
    case "depth":
      return new THREE11.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: DEPTH_FRAGMENT, ...offset });
  }
}
function idScene(meshes) {
  const group = new THREE11.Group();
  group.position.copy(root.position);
  group.add(...meshes);
  const scene2 = new THREE11.Scene();
  scene2.add(group);
  return scene2;
}
var CHANNEL_ON = 128;
function unpack24(bytes, offset) {
  return bytes[offset] + 256 * bytes[offset + 1] + 65536 * bytes[offset + 2];
}
var UNCAPPED_RADIUS = 1e9;
var SHELL_VERTEX = `
    uniform float outlineThickness;
    uniform float outlineScale;
    #define OUTLINE_SIZE_FRACTION ${OUTLINE_SIZE_FRACTION.toFixed(3)}
    float outlineWidth(float clipW, float radius) {
      float capWidth = OUTLINE_SIZE_FRACTION * radius * projectionMatrix[1][1] / clipW;
      return min(outlineThickness, capWidth);
    }
    void main() {
      vec4 local = vec4(position, 1.0);
      vec3 normalLocal = normal;
      float radius = ${UNCAPPED_RADIUS.toFixed(1)};
      #ifdef USE_INSTANCING
        mat3 instanceRotation = mat3(instanceMatrix);
        normalLocal = instanceRotation * (normal / vec3(dot(instanceRotation[0], instanceRotation[0]), dot(instanceRotation[1], instanceRotation[1]), dot(instanceRotation[2], instanceRotation[2])));
        local = instanceMatrix * local;
        radius = min(length(instanceRotation[0]), length(instanceRotation[2]));
      #endif
      normalLocal = normalize(normalLocal);
      vec4 clipPos = projectionMatrix * modelViewMatrix * local;
      vec4 clipPosInward = projectionMatrix * modelViewMatrix * vec4(local.xyz - normalLocal, 1.0);
      float width = outlineWidth(clipPos.w, radius) * outlineScale;
      gl_Position = clipPos + normalize(clipPos - clipPosInward) * width * clipPos.w;
    }`;
var SHELL_FRAGMENT = `
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }`;
var ZERO_FRAGMENT = `
    void main() {
      gl_FragColor = vec4(0.0);
    }`;
var shellMaterial = (outlineScale2) => new THREE11.ShaderMaterial({
  vertexShader: SHELL_VERTEX,
  fragmentShader: SHELL_FRAGMENT,
  side: THREE11.BackSide,
  uniforms: { outlineThickness: { value: OUTLINE_THICKNESS }, outlineScale: { value: outlineScale2 } }
});
var occluderMaterial = (faces) => new THREE11.ShaderMaterial({
  vertexShader: PLAIN_VERTEX,
  fragmentShader: ZERO_FRAGMENT,
  ...faces ? { polygonOffset: true, polygonOffsetFactor: FACE_OFFSET_FACTOR2, polygonOffsetUnits: FACE_OFFSET_UNITS2 } : {}
});
function renderPasses(groups, cssWidth, cssHeight, scale, outlineScale2) {
  const { meshes, shells, thin, lines } = groups;
  const width = cssWidth * scale;
  const height = cssHeight * scale;
  const count2 = width * height;
  const passes = new Passes(width, height, new Uint32Array(count2), new Float32Array(count2).fill(BACKGROUND_DEPTH), new Uint8Array(count2), new Uint32Array(count2));
  const all = [...meshes, ...shells, ...thin, ...lines];
  const scene2 = idScene(all);
  const materials = {
    id: [passMaterial("id", false), passMaterial("id", true)],
    band: [passMaterial("band", false), passMaterial("band", true)],
    depth: [passMaterial("depth", false), passMaterial("depth", true)]
  };
  const pick = (pass) => (mesh) => materials[pass][roleOf(mesh).shape === "polyhedron" ? 1 : 0];
  const maskShell = shellMaterial(outlineScale2);
  const maskPlain = occluderMaterial(false);
  const maskFaces = occluderMaterial(true);
  const maskPick = (mesh) => roleOf(mesh).role === "shell" ? maskShell : roleOf(mesh).shape === "polyhedron" ? maskFaces : maskPlain;
  const lineIdMaterial = passMaterial("id", false);
  const linePick = (mesh) => {
    const role = roleOf(mesh);
    return role.role === "line" || role.role === "thin" ? lineIdMaterial : role.shape === "polyhedron" ? maskFaces : maskPlain;
  };
  const show2 = (pass) => {
    for (const m of shells) m.visible = pass === "mask";
    for (const m of [...thin, ...lines]) m.visible = pass === "line";
  };
  const tile = renderer.capabilities.maxTextureSize;
  camera.updateMatrixWorld();
  try {
    for (let y0 = 0; y0 < height; y0 += tile) {
      for (let x0 = 0; x0 < width; x0 += tile) {
        const tw = Math.min(tile, width - x0);
        const th = Math.min(tile, height - y0);
        camera.setViewOffset(width, height, x0, y0, tw, th);
        show2("id");
        const ids = readPass(scene2, all, pick("id"), tw, th);
        show2("band");
        const bands = readPass(scene2, all, pick("band"), tw, th);
        show2("depth");
        const depths = readPass(scene2, all, pick("depth"), tw, th);
        show2("mask");
        const masks = readPass(scene2, all, maskPick, tw, th);
        show2("line");
        const lineIds = readPass(scene2, all, linePick, tw, th);
        storeTile(passes, { x0, y0, tw, th, ids, bands, depths, masks, lineIds });
      }
    }
  } finally {
    renderer.setRenderTarget(null);
    camera.clearViewOffset();
    for (const material of [...Object.values(materials).flat(), maskShell, maskPlain, maskFaces, lineIdMaterial]) material.dispose();
  }
  return passes;
}
function storeTile(out, t) {
  for (let row = 0; row < t.th; row++) {
    const topRow = t.th - 1 - row;
    for (let col = 0; col < t.tw; col++) {
      const src = (row * t.tw + col) * 4;
      const dst = (t.y0 + topRow) * out.width + t.x0 + col;
      out.shell[dst] = t.masks[src] >= CHANNEL_ON ? 1 : 0;
      out.lineId[dst] = unpack24(t.lineIds, src);
      const id = unpack24(t.ids, src);
      if (id === 0) continue;
      out.keys[dst] = t.bands[src] < CHANNEL_ON ? darkKey(id) : litKey(id);
      out.depth[dst] = unpack24(t.depths, src) / DEPTH_SCALE;
    }
  }
}
function readPass(scene2, all, materialOf, tw, th) {
  for (const mesh of all) mesh.material = materialOf(mesh);
  const target = new THREE11.WebGLRenderTarget(tw, th, { depthBuffer: true, minFilter: THREE11.NearestFilter, magFilter: THREE11.NearestFilter, generateMipmaps: false });
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene2, camera);
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
function projector(width, height) {
  return (p) => {
    const ndc = p.clone().add(root.position).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    return { x: (ndc.x + 1) / 2 * width, y: (1 - ndc.y) / 2 * height, depth: ndc.z / 2 + 0.5 };
  };
}

// src/trace/stretch.ts
var SNAP_TOL_RENDER_PX = 0.6;
var BAND_OFFSETS_PX = [0.5, 1, 1.5];
var FLAG_HALF_WINDOW = 3;
var BACKGROUND = 0;
function stretchesOf(ring, id, passes, scale) {
  const labels = fillGaps(ring.map(([x, y]) => labelAt(x, y, id, passes)));
  if (labels === null) return { stretches: [], whole: false };
  const css = ring.map(([x, y]) => [x / scale, y / scale]);
  const ctx = { id, passes, scale };
  if (labels.every((l) => l === labels[0])) return wholeRing(css, labels[0], ctx);
  const [pts, rotatedLabels] = rotateToChange(css, labels);
  return { stretches: splitAtLabelChanges(pts, rotatedLabels, ctx), whole: false };
}
function wholeRing(css, label, ctx) {
  const flags = shellFlags(css, true, ctx);
  if (flags.every((f) => f === flags[0])) return { stretches: [{ pts: css, label, outlined: flags[0] }], whole: true };
  return { stretches: cyclicRuns(css, flags, label), whole: false };
}
function fillGaps(labels) {
  const first = labels.find((l) => l !== null);
  if (first === void 0) return null;
  let prev = first;
  return labels.map((l) => {
    if (l === null) return prev;
    prev = l;
    return l;
  });
}
function rotateToChange(css, labels) {
  const start = labels.findIndex((l, i) => l !== labels[(i - 1 + labels.length) % labels.length]);
  return [[...css.slice(start), ...css.slice(0, start)], [...labels.slice(start), ...labels.slice(0, start)]];
}
function splitAtLabelChanges(pts, labels, ctx) {
  const stretches = [];
  for (let i = 0; i < pts.length; ) {
    let j = i;
    while (j + 1 < pts.length && labels[j + 1] === labels[i]) j++;
    const span2 = pts.slice(i, j + 1);
    for (const piece of runsOf(span2, shellFlags(span2, false, ctx))) {
      stretches.push({ pts: piece.pts, label: labels[i], outlined: piece.outlined });
    }
    i = j + 1;
  }
  return stretches;
}
function labelAt(x, y, id, passes) {
  const left = Math.floor(x - 0.5);
  const top = Math.floor(y - 0.5);
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
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
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
  const n = pts.length;
  const raw = pts.map((p, i) => {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const [nx, ny] = outwardNormal(p, a, b, ctx);
    let hits = 0;
    for (const d of BAND_OFFSETS_PX) if (shellAt([p[0] + nx * d / ctx.scale, p[1] + ny * d / ctx.scale], ctx)) hits++;
    return hits * 2 > BAND_OFFSETS_PX.length;
  });
  return majority(raw, closed);
}
function outwardNormal(p, a, b, ctx) {
  const tx = b[0] - a[0];
  const ty = b[1] - a[1];
  const len = Math.hypot(tx, ty) || 1;
  const n = [ty / len, -tx / len];
  return ownAt([p[0] + n[0] / ctx.scale, p[1] + n[1] / ctx.scale], ctx) ? [-n[0], -n[1]] : n;
}
function majority(flags, closed) {
  const n = flags.length;
  return flags.map((_, i) => {
    let count2 = 0;
    let seen = 0;
    for (let k = -FLAG_HALF_WINDOW; k <= FLAG_HALF_WINDOW; k++) {
      const j = closed ? (i + k + n * 2) % n : i + k;
      if (j < 0 || j >= n) continue;
      seen++;
      if (flags[j]) count2++;
    }
    return count2 * 2 > seen;
  });
}
var pixelOf = (p, ctx) => [Math.floor(p[0] * ctx.scale), Math.floor(p[1] * ctx.scale)];
function ownAt(p, ctx) {
  const key2 = ctx.passes.keyAt(...pixelOf(p, ctx));
  return key2 !== 0 && idOf(key2) === ctx.id;
}
function shellAt(p, ctx) {
  return ctx.passes.shellAt(...pixelOf(p, ctx));
}
function runsOf(pts, flags) {
  const out = [];
  if (pts.length < 2) return [{ pts, outlined: flags[0] }];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && flags[j + 1] === flags[i]) j++;
    out.push({ pts: pts.slice(i, j + 1), outlined: flags[i] });
    i = j;
  }
  return out;
}
function cyclicRuns(pts, flags, label) {
  const n = pts.length;
  const change = flags.findIndex((f, i) => f !== flags[(i - 1 + n) % n]);
  const from = change < 0 ? 0 : change;
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
      const d3 = `M${startOf(best.e, st.pts[0])}${fullEllipseArcs(best.e, pointAt(best.e, paramOf(best.e, st.pts[0])))}Z`;
      return { fill: d3, outline: st.outlined ? d3 : "" };
    }
    const d2 = closedPath(st.pts);
    return { fill: d2, outline: st.outlined ? d2 : "" };
  }
  const bests = stretches.map((st) => bestCurve(candidates(st), st.pts, tol));
  let cur = startOn(bests[0], stretches[0].pts[0]);
  let d = `M${fmtPt(cur)}`;
  const pieces = [];
  stretches.forEach((st, index) => {
    const start = cur;
    const piece = pieceFor(st, bests[index], start);
    cur = piece.end;
    d += piece.cmd;
    pieces.push({ start, cmd: piece.cmd, outlined: st.outlined });
  });
  d += "Z";
  return { fill: d, outline: outlineOf2(pieces) };
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
  for (const p of pieces) {
    if (!p.outlined) {
      open = false;
      continue;
    }
    if (!open) out += `M${fmtPt(p.start)}`;
    out += p.cmd;
    open = true;
  }
  return out;
}
function bestCurve(curves, pts, tol) {
  let best = null;
  let bestRms = tol;
  for (const c of curves) {
    const rms = curveRms(c, pts);
    if (rms <= bestRms) {
      best = c;
      bestRms = rms;
    }
  }
  return best;
}
function snapTolerance(scale) {
  return SNAP_TOL_RENDER_PX / scale;
}
function startOn(curve, p) {
  if (!curve) return p;
  if (curve.kind === "line") return onLine(curve.a, curve.b, p);
  return pointAt(curve.e, paramOf(curve.e, p));
}
function startOf(e, p) {
  return fmtPt(pointAt(e, paramOf(e, p)));
}

// src/trace/traced.ts
var TRACE_SCALE = 2;
var SEAM_TRAP_PX = 0.5;
var SEAM_STROKE_WIDTH = 2 * SEAM_TRAP_PX;
var THIN_AS_LINE_PX = 3;
var EDGE_WIDTH = 1;
var BOX_LINE_WIDTH = 1;
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
  counted(markup) {
    this.paths++;
    return markup;
  }
};
function buildTracedSvg(options) {
  const started = performance.now();
  const view = makeView(options);
  const prepared = prepareScene(options, view);
  try {
    const shown2 = (mesh) => options.show.atoms || roleOf(mesh).shape !== "sphere";
    const { built, lines } = prepared;
    const passes = renderPasses(
      { meshes: built.meshes.filter(shown2), shells: built.shells.filter(shown2), thin: built.thin, lines },
      options.width,
      options.height,
      TRACE_SCALE,
      options.outlineScale
    );
    const frame3 = makeFrame(options, view, prepared, passes);
    const layers = new Layers();
    for (const { id, obj } of drawOrder(frame3)) {
      if (obj.kind !== "polyhedron" && isThin(view, obj)) traceThin(frame3, layers, id, obj);
      else traceObject(frame3, layers, id, obj);
    }
    const text = documentText(frame3, layers);
    return { text, paths: layers.paths, ms: performance.now() - started };
  } finally {
    disposeMeshes([...prepared.built.meshes, ...prepared.built.shells, ...prepared.built.thin, ...prepared.lines]);
  }
}
function prepareScene(options, view) {
  const built = buildIdMeshes(options.data, passMaterial("id", false), (obj) => !isThin(view, obj));
  const points2 = new Map(options.data.points.map((p) => [p.id, p.position]));
  const topologies = new Map(options.data.topologies.map((t) => [t.id, t]));
  const edgeSpans = [];
  let nextId = built.objects.length + 1;
  built.objects.forEach((obj, index) => {
    if (obj.kind !== "polyhedron") return;
    const poly = options.data.primitives.polyhedra[obj.poly];
    for (const [a, b] of hardEdges(topologies.get(poly.topology_id), points2)) edgeSpans.push({ owner: index + 1, a, b, id: nextId++ });
  });
  const boxId = nextId;
  const boxEdges = options.show.box && options.data.cell ? cellEdges(options.data.cell) : [];
  const edgeLines = lineSet(edgeSpans.map((e) => [e.a, e.b, e.id]));
  const boxLines = lineSet(boxEdges.map(([a, b]) => [a, b, boxId]));
  const lines = [edgeLines, boxLines].filter((set) => set.geometry.getAttribute("position").count > 0);
  return { built, points: points2, topologies, edgeSpans, boxEdges, boxId, lines };
}
function lineSet(segments) {
  const positions = new Float32Array(segments.length * 6);
  const ids = new Float32Array(segments.length * 2);
  segments.forEach(([a, b, id], k) => {
    positions.set([a.x, a.y, a.z, b.x, b.y, b.z], 6 * k);
    ids.set([id, id], 2 * k);
  });
  const geometry = new THREE12.BufferGeometry();
  geometry.setAttribute("position", new THREE12.BufferAttribute(positions, 3));
  geometry.setAttribute("objectId", new THREE12.BufferAttribute(ids, 1));
  const set = new THREE12.LineSegments(geometry, new THREE12.LineBasicMaterial());
  set.userData = { role: "line" };
  return set;
}
function makeFrame(options, view, prepared, passes) {
  const project = projector(passes.width, passes.height);
  return {
    options,
    view,
    prepared,
    passes,
    stats: objectBoxes(passes, prepared.built.objects.length),
    project,
    linePass: new LinePass(project, passes, TRACE_SCALE),
    curves: makeCurveLookup(options, view, prepared),
    tol: snapTolerance(TRACE_SCALE),
    edgeHex: srgbHex(LOOK.outline),
    outlineHex: linearHex(LOOK.outline),
    // The live view's outline is OUTLINE_THICKNESS of the image height; a centred stroke of half of it shows its visible width.
    outlineWidth: OUTLINE_THICKNESS * options.height
  };
}
function drawOrder(f) {
  return f.prepared.built.objects.map((obj, i) => ({ id: i + 1, nearestDepth: isThin(f.view, obj) ? f.project(vec3(obj.centre)).depth : f.stats.nearest[i + 1], obj })).sort((p, q) => q.nearestDepth - p.nearestDepth);
}
function traceObject(f, layers, id, obj) {
  const box2 = boxOf(f.stats.boxes, id);
  if (box2.x1 < box2.x0) return;
  const rgb = fillRgb(f.options, obj);
  const lit = srgbHex(rgb);
  const dark = shadedBand(rgb, LOOK.dark);
  const common = { "fill-rule": "evenodd", ...obj.alpha < 1 ? { "fill-opacity": obj.alpha } : {} };
  const region = regionFill(f, id, obj, box2);
  let body = "";
  if (region.fill) {
    body += layers.counted(seamTrapped(region.fill, lit, common));
    layers.clips.push(el("clipPath", { id: `k${id}` }, el("path", { d: region.fill, "clip-rule": "evenodd" })));
  }
  const band = darkBandPath(f, id, box2);
  if (band) body += layers.counted(seamTrapped(band, dark, { ...common, "clip-path": region.fill ? `url(#k${id})` : void 0 }));
  if (obj.kind === "polyhedron") {
    const d = polyhedronEdgePath(f, id);
    if (d) body += layers.counted(el("path", { d, fill: "none", stroke: f.edgeHex, "stroke-width": EDGE_WIDTH, "stroke-linecap": "round" }));
  }
  layers.fills.push(el("g", {}, body));
  if (f.options.outlines && obj.outlined && region.outline) layers.outlines.push(layers.counted(outlineMarkup(f, obj, region.outline)));
}
function regionFill(f, id, obj, box2) {
  const { passes, stats } = f;
  const regionPx = stats.pixels[id] / (TRACE_SCALE * TRACE_SCALE);
  let regionRingsOf = regionRings(passes, box2, (k) => idOf(k) === id);
  let fill = "";
  if (regionPx < MIN_REGION_PX) {
    const exact = f.curves.own(id).find((c) => c.kind === "ellipse");
    const centre2 = f.project(vec3(obj.centre));
    if (exact && exact.kind === "ellipse" && keyAtCentre(passes, centre2) === id && regionPx >= MIN_SILHOUETTE_PX) {
      fill = closedPath(silhouettePoints(exact.e));
    }
    regionRingsOf = [];
  } else {
    regionRingsOf = regionRingsOf.filter((ring) => ringArea(ring, TRACE_SCALE) >= MIN_REGION_PX);
  }
  let outline = "";
  for (const ring of regionRingsOf) {
    const { stretches, whole } = stretchesOf(ring, id, passes, TRACE_SCALE);
    const parts = ringPaths(stretches, whole, (st) => f.curves.candidatesFor(id, st), f.tol);
    fill += parts.fill;
    outline += parts.outline;
  }
  return { fill, outline };
}
function darkBandPath(f, id, box2) {
  const { passes } = f;
  const rings = regionRings(passes, box2, (k) => k === darkKey(id)).filter((ring) => ringArea(ring, TRACE_SCALE) >= MIN_REGION_PX && ringArea(ring, TRACE_SCALE) / Math.max(ringPerimeter(ring, TRACE_SCALE), MIN_PERIMETER_PX) >= MIN_STRIP_PX);
  return rings.map((ring) => closedPath(toCss(ring, TRACE_SCALE))).join("");
}
function toCss(ring, scale) {
  return ring.map(([x, y]) => [x / scale, y / scale]);
}
function polyhedronEdgePath(f, id) {
  return segmentsPath(f.prepared.edgeSpans.filter((e) => e.owner === id).flatMap((e) => f.linePass.spansOf(e.a, e.b, e.id)));
}
function outlineMarkup(f, obj, d) {
  const r = radiusPx(f.view, obj);
  const width = r === null ? f.outlineWidth / 2 : Math.min(f.outlineWidth / 2, 2 * OUTLINE_SIZE_FRACTION * r);
  const strokeWidth = f.options.outlineScale * width;
  return el("path", { d, fill: "none", stroke: f.outlineHex, "stroke-width": strokeWidth, "stroke-linejoin": "round" });
}
function fillRgb(options, obj) {
  return obj.material === null ? arrowColor() : colorOf(options, obj.material);
}
function seamTrapped(d, colour, extra) {
  return el("path", { d, fill: colour, stroke: colour, "stroke-width": SEAM_STROKE_WIDTH, "stroke-linejoin": "round", ...extra });
}
function traceThin(f, layers, id, obj) {
  const lit = srgbHex(fillRgb(f.options, obj));
  const radius = radiusPx(f.view, obj) ?? 0;
  const thinSvg = obj.kind === "dot" ? dotMarkup(obj, lit, id, f.linePass, radius) : barMarkup(obj, lit, id, f.linePass, radius);
  if (thinSvg) layers.fills.push(layers.counted(thinSvg));
}
function dotMarkup(obj, lit, id, lines, radius) {
  const p = lines.project(vec3(obj.centre));
  if (!onScreen(p)) return "";
  if (!lines.shows(id, Math.floor(p.x), Math.floor(p.y))) return "";
  return el("circle", { cx: p.x / lines.scale, cy: p.y / lines.scale, r: radius, fill: lit });
}
function barMarkup(obj, lit, id, lines, radius) {
  const m = obj.matrix;
  const c = vec3(obj.centre);
  const axis = new THREE12.Vector3(m[4], m[5], m[6]).multiplyScalar(HALF_AXIS);
  const d = segmentsPath(lines.spansOf(c.clone().sub(axis), c.clone().add(axis), id));
  return d ? el("path", { d, fill: "none", stroke: lit, "stroke-width": 2 * radius, "stroke-linecap": "round" }) : "";
}
function documentText(f, layers) {
  const { options, view } = f;
  const body = `${el("defs", {}, layers.clips.join(""))}
${layers.fills.join("\n")}
${cellBoxMarkup(f, layers)}
${layers.outlines.join("\n")}
${triadSvg({ o: options, view })}`;
  const style = textEl("style", {}, axisFontFace(["700"]));
  const svg = el("svg", { xmlns: "http://www.w3.org/2000/svg", width: options.width, height: options.height, viewBox: `0 0 ${options.width} ${options.height}` }, `
${style}
${body}
`);
  return `${svg}
`;
}
function cellBoxMarkup(f, layers) {
  const { options, prepared } = f;
  if (!options.show.box || !options.data.cell) return "";
  const d = segmentsPath(prepared.boxEdges.flatMap(([a, b]) => f.linePass.spansOf(a, b, prepared.boxId)));
  return d ? layers.counted(el("path", { d, fill: "none", stroke: options.boxColor, "stroke-width": BOX_LINE_WIDTH })) : "";
}
function makeCurveLookup(options, view, prepared) {
  const screen = screenOf(view);
  const { built, points: points2 } = prepared;
  const own = memo((id) => {
    const obj = built.objects[id - 1];
    if (obj.kind === "polyhedron") return edgeCurves(hardEdges(topologyOf(options, prepared, obj.poly), points2), screen);
    if (obj.kind === "sphere" || obj.kind === "dot") return sphereCurves(view, vec3(obj.centre), obj.matrix[0]);
    if (obj.kind === "cylinder") return cylinderCurves(obj.matrix, screen);
    return [];
  });
  const facesOf = memo((poly) => {
    const topo = topologyOf(options, prepared, poly);
    return topo.faces.map(([i, j, k]) => [i, j, k].map((q) => vec3(points2.get(topo.point_ids[q]))));
  });
  const sectionOfFace = (poly, other, mid) => {
    const face = nearestFace(facesOf(poly.poly), mid, screen);
    return face ? sectionCurves(other, face, screen) : [];
  };
  const crossing = (id, label, mid) => {
    const a = built.objects[id - 1];
    const b = built.objects[label - 1];
    if (a.kind === "polyhedron" && b.kind !== "polyhedron") return sectionOfFace(a, b, mid);
    if (b.kind === "polyhedron" && a.kind !== "polyhedron") return sectionOfFace(b, a, mid);
    return [];
  };
  const candidatesFor = (id, st) => {
    if (st.label <= 0) return own(id);
    const mid = st.pts[Math.floor(st.pts.length / 2)];
    return [...own(id), ...own(st.label), ...crossing(id, st.label, mid)];
  };
  return { own, candidatesFor };
}
function sectionCurves(other, face, screen) {
  if (other.kind === "sphere" || other.kind === "dot") {
    const c = sectionCurve(vec3(other.centre), other.matrix[0], face, screen);
    return c ? [c] : [];
  }
  if (other.kind === "cylinder") {
    const c = cylinderSectionCurve(other.matrix, face, screen);
    return c ? [c] : [];
  }
  return [];
}
function topologyOf(options, prepared, poly) {
  return prepared.topologies.get(options.data.primitives.polyhedra[poly].topology_id);
}
function memo(compute) {
  const cache = /* @__PURE__ */ new Map();
  return (key2) => {
    if (!cache.has(key2)) cache.set(key2, compute(key2));
    return cache.get(key2);
  };
}
function screenOf(view) {
  return (p) => {
    const s = view.toScreen(view.toCam(p));
    return [s.x, s.y];
  };
}
function silhouettePoints(e) {
  return Array.from({ length: SILHOUETTE_SAMPLES }, (_, i) => pointAt(e, 2 * Math.PI * i / SILHOUETTE_SAMPLES));
}
function radiusPx(view, obj) {
  if (obj.kind === "polyhedron") return null;
  const m = obj.matrix;
  const unit = obj.kind === "cylinder" ? Math.hypot(m[0], m[1], m[2]) : obj.kind === "sphere" || obj.kind === "dot" ? m[0] : null;
  return unit === null ? null : unit * view.pxPerUnit(view.toCam(vec3(obj.centre)));
}
function isThin(view, obj) {
  return (obj.kind === "cylinder" || obj.kind === "dot") && (radiusPx(view, obj) ?? Infinity) * 2 < THIN_AS_LINE_PX;
}

// src/ui/theme.ts
var THEME_KEY = "gemmy.theme";
var THEME_CHOICES = ["auto", "light", "dark"];
var AUTO = "auto";
var THEME_ATTRIBUTE = "data-theme";
function isThemeChoice(value) {
  return THEME_CHOICES.some((choice) => choice === value);
}
var listeners = [];
function onThemeChange(listener) {
  listeners.push(listener);
}
function readStoredChoice() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isThemeChoice(value) ? value : AUTO;
  } catch {
    return AUTO;
  }
}
function storeTheme(choice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
  }
}
function applyToPage(choice) {
  if (choice === AUTO) document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  else document.documentElement.setAttribute(THEME_ATTRIBUTE, choice);
}
var current2 = readStoredChoice();
applyToPage(current2);
function currentTheme() {
  return current2;
}
function setTheme(choice) {
  current2 = choice;
  storeTheme(choice);
  applyToPage(choice);
  for (const listener of listeners) listener(choice);
}
function cycleTheme() {
  const next = (THEME_CHOICES.indexOf(current2) + 1) % THEME_CHOICES.length;
  setTheme(THEME_CHOICES[next]);
}

// src/ui/outline-scale.ts
var OUTLINE_SCALE_KEY = "gemmy.outline-scale";
var OUTLINE_SCALE_CHOICES = [0.5, 1, 1.75];
var DEFAULT_SCALE = 1;
function isOutlineScale(value) {
  return OUTLINE_SCALE_CHOICES.some((choice) => choice === value);
}
function readStoredScale() {
  try {
    const value = Number(localStorage.getItem(OUTLINE_SCALE_KEY));
    return isOutlineScale(value) ? value : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
}
function storeScale(scale) {
  try {
    localStorage.setItem(OUTLINE_SCALE_KEY, String(scale));
  } catch {
  }
}
var listeners2 = [];
function onOutlineScaleChange(listener) {
  listeners2.push(listener);
}
var current3 = readStoredScale();
setOutlineScale(current3);
function outlineScale() {
  return current3;
}
function chooseOutlineScale(scale) {
  current3 = scale;
  storeScale(scale);
  setOutlineScale(scale);
  requestRender();
  for (const listener of listeners2) listener(scale);
}

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
  if (file.size > MAX_SCENE_BYTES) throw new SceneError(`${file.name} is larger than ${MAX_SCENE_BYTES / MEGABYTE} MB.`);
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
    throw new SceneError("The JSON has a schema_version but no points, primitives and materials: it is not a gemmy scene.");
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
  return urls.map((value) => ({ kind: "url", url: resolveWebUrl(value, base) }));
}
function resolveWebUrl(value, base) {
  if (value.trim() === "") throw new SourceError("scene= needs a URL.");
  let url;
  try {
    url = new URL(value.trim(), base);
  } catch {
    throw new SourceError(`"${value}" is not a URL.`);
  }
  if (!WEB_PROTOCOLS.includes(url.protocol)) throw new SourceError(`Only http and https scene URLs can be opened, not "${value}".`);
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
  if (sources.length > 0) return sources.map((source) => ({ source, byDefault: false }));
  return defaults.map((scene2) => ({ source: { kind: "url", url: resolveWebUrl(scene2, base) }, byDefault: true }));
}
function linkFor(source, byDefault, pageHref) {
  const link = new URL(pageHref);
  link.hash = "";
  const query = byDefault ? {} : source.kind === "gist" ? { gist: source.id, ...source.file === null ? {} : { file: source.file } } : { scene: source.url };
  link.search = new URLSearchParams(query).toString();
  return link.href;
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
    throw new SceneError(`Could not fetch ${url}: the network failed, or the server does not allow this page to read it (CORS).`);
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

// src/ui/loader.ts
var empty = byId("empty");
var emptyStatus = byId("empty-status");
var emptyError = byId("empty-error");
var urlForm = byId("empty-url");
var urlInput = byId("scene-url");
var fileInput = byId("scene-file");
var closeButton = byId("empty-close");
var messageOf2 = (error) => error instanceof Error ? error.message : String(error);
var sceneOpen = false;
function showCard() {
  empty.hidden = false;
  closeButton.hidden = !sceneOpen;
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
function labelOf(source) {
  return source.kind === "gist" ? `gist ${source.id}` : source.url;
}
async function loadSource(source, byDefault) {
  const link = linkFor(source, byDefault, location.href);
  if (source.kind === "gist") {
    const { name, doc } = await fetchGist(source.id, source.file);
    return { doc, name, from: labelOf(source), link };
  }
  return { doc: await fetchScene(source.url), name: sceneName(source), from: source.url, link };
}
async function present(label, loading, show2) {
  busy(`Loading ${label}\u2026`);
  try {
    show2(await loading());
    sceneOpen = true;
    hideCard();
  } catch (error) {
    fail(`Could not load ${label}: ${messageOf2(error)}`);
  }
}
function fromFile(file, show2) {
  return present(file.name, async () => ({ doc: await sceneFromFile(file), name: file.name, from: "local file", link: null }), show2);
}
function defaultScenes() {
  return [...document.querySelectorAll('meta[name="gemmy-default-scene"]')].map((meta) => meta.content).filter((scene2) => scene2 !== "");
}
function startLoader(show2) {
  let openings;
  try {
    openings = sourcesToOpen(location.search, location.href, defaultScenes());
  } catch (error) {
    fail(messageOf2(error));
    return;
  }
  if (openings.length === 0) {
    showCard();
  } else if (openings.length === 1) {
    const [only] = openings;
    void present(labelOf(only.source), () => loadSource(only.source, only.byDefault), show2);
  } else {
    openTabs(openings, show2);
  }
}
function openTabs(openings, show2) {
  const bar = document.createElement("nav");
  bar.className = "tabs";
  bar.setAttribute("aria-label", "Scenes");
  const loaded = /* @__PURE__ */ new Map();
  const buttons = openings.map(({ source }, k) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = sceneName(source);
    button.addEventListener("click", () => choose(k));
    bar.appendChild(button);
    return button;
  });
  const choose = (k) => {
    buttons.forEach((button, j) => {
      if (j === k) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const { source, byDefault } = openings[k];
    void present(labelOf(source), async () => {
      const shown2 = loaded.get(k) ?? await loadSource(source, byDefault);
      loaded.set(k, shown2);
      return shown2;
    }, show2);
  };
  byId("menu-island").insertBefore(bar, document.querySelector(".name"));
  choose(0);
}
function showUrlForm() {
  showCard();
  urlInput.focus();
}
function closeUrlForm() {
  if (empty.hidden || !sceneOpen) return false;
  hideCard();
  return true;
}
function attachOpeners(show2) {
  closeButton.addEventListener("click", () => closeUrlForm());
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
    const file = event.dataTransfer?.files[0];
    if (file) void fromFile(file, show2);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void fromFile(file, show2);
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

// src/ui/menus.ts
var PNG_SCALE = 2;
var KB = 1024;
var DOWNLOAD_REVOKE_MS = 1e4;
var DEFAULT_SCENE_FILE = "scene.json";
function projectionName() {
  return isPersp() ? "persp" : "ortho";
}
var currentView = () => exportView({
  quaternion: camera.quaternion.toArray(),
  zoom: currentZoom(),
  target: controls.target.toArray(),
  centre,
  box: show.box,
  width: stage.clientWidth,
  height: stage.clientHeight,
  projection: projectionName(),
  lens
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
  const w = stage.clientWidth, h = stage.clientHeight, ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(PNG_SCALE);
  renderer.setSize(w, h);
  renderer.render(scene, camera);
  const out = document.createElement("canvas");
  out.width = w * PNG_SCALE;
  out.height = h * PNG_SCALE;
  const ctx = out.getContext("2d");
  if (!transparent) {
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(renderer.domElement, 0, 0);
  ctx.drawImage(triadAt(PNG_SCALE), 0, 0);
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h);
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
function triadAt(scale) {
  const canvas = document.createElement("canvas");
  drawTriad(canvas, canvas.getContext("2d"), scale);
  return canvas;
}
function exportSvg() {
  const boxColor = getComputedStyle(document.documentElement).getPropertyValue("--box").trim();
  let result;
  try {
    result = buildTracedSvg({
      data,
      centre,
      extent,
      quaternion: camera.quaternion.toArray(),
      zoom: currentZoom(),
      target: controls.target.toArray(),
      projection: projectionName(),
      lens,
      width: stage.clientWidth,
      height: stage.clientHeight,
      show,
      outlines,
      outlineScale: outlineScale(),
      lattice: lattice.map((v) => v.toArray()),
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
  say(`Saved view.svg (${Math.round(result.text.length / KB)} kB, ${result.paths} paths, ${Math.round(result.ms)} ms).`);
}
var EXPORTS = {
  svg: exportSvg,
  png: () => exportPng(byId("png-transparent").checked),
  "save-toml": () => saveFile("render-settings.toml", "application/toml", settingsToml(currentView())),
  "save-json": () => saveFile("render-settings.json", "application/json", settingsJson(currentView())),
  "copy-toml": () => copyText(settingsToml(currentView()), "the TOML settings"),
  "copy-json": () => copyText(settingsJson(currentView()), "the JSON settings"),
  "copy-command": () => copyText(renderCommand(currentView(), sceneFileName()), "the command")
};
function sceneFileName() {
  const meta = document.querySelector('meta[name="gemmy-scene-file"]');
  return meta?.content || DEFAULT_SCENE_FILE;
}
var POPOVER_GAP_PX = 6;
var POPOVER_MARGIN_PX = 8;
var POPOVER_CLEARANCE_PX = 14;
function placePopover(button, panel) {
  const r = button.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  const below = r.top + r.height / 2 < H / 2;
  panel.style.maxHeight = `${(below ? H - r.bottom : r.top) - POPOVER_CLEARANCE_PX}px`;
  const w = panel.offsetWidth, h = panel.offsetHeight;
  const left = r.left + r.width / 2 < W / 2 ? r.left : r.right - w;
  panel.style.left = `${clamp(left, POPOVER_MARGIN_PX, W - w - POPOVER_MARGIN_PX)}px`;
  panel.style.top = `${below ? r.bottom + POPOVER_GAP_PX : r.top - POPOVER_GAP_PX - h}px`;
}
function focusable(panel) {
  return [...panel.querySelectorAll("button, input")].filter((el2) => !el2.hidden && !el2.closest("[hidden]"));
}
function moveFocus(key2, list) {
  const i = list.indexOf(document.activeElement);
  if (key2 === "ArrowDown") list[(i + 1) % list.length]?.focus();
  else if (key2 === "ArrowUp") list[(i + list.length - 1) % list.length]?.focus();
  else if (key2 === "Home") list[0]?.focus();
  else if (key2 === "End") list[list.length - 1]?.focus();
  else return false;
  return true;
}
var popovers = [];
function popover(button, panel) {
  const self = {
    button,
    panel,
    place: () => placePopover(button, panel),
    open() {
      for (const other of popovers) if (other !== self) other.close();
      panel.hidden = false;
      self.place();
      button.setAttribute("aria-expanded", "true");
      focusable(panel)[0]?.focus();
    },
    close(refocus = false) {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (refocus) button.focus();
    },
    toggle() {
      if (panel.hidden) self.open();
      else self.close();
    }
  };
  button.addEventListener("click", self.toggle);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      self.close();
      return;
    }
    if (moveFocus(e.key, focusable(panel))) e.preventDefault();
  });
  popovers.push(self);
  return self;
}
var exportMenu = byId("export-menu");
var exportPopover = popover(byId("export-button"), exportMenu);
var mainMenu = popover(byId("menu-button"), byId("main-menu"));
byId("open-url").addEventListener("click", () => {
  mainMenu.close();
  showUrlForm();
});
var themeSegments = [...document.querySelectorAll("[data-theme-choice]")];
function showThemeChoice(choice) {
  for (const segment of themeSegments) segment.setAttribute("aria-pressed", String(segment.dataset.themeChoice === choice));
}
function chooseFromSegment(segment) {
  const choice = segment.dataset.themeChoice;
  if (isThemeChoice(choice)) setTheme(choice);
}
for (const segment of themeSegments) segment.addEventListener("click", () => chooseFromSegment(segment));
onThemeChange(showThemeChoice);
showThemeChoice(currentTheme());
var outlineSegments = [...document.querySelectorAll("[data-outline-scale]")];
function showOutlineScale(scale) {
  for (const segment of outlineSegments) segment.setAttribute("aria-pressed", String(Number(segment.dataset.outlineScale) === scale));
}
for (const segment of outlineSegments) {
  segment.addEventListener("click", () => chooseOutlineScale(Number(segment.dataset.outlineScale)));
}
onOutlineScaleChange(showOutlineScale);
showOutlineScale(outlineScale());
var helpPopover = popover(byId("help-button"), byId("help"));
exportMenu.addEventListener("click", (e) => {
  const item = closestOf(e.target, "[data-export]");
  if (item) EXPORTS[item.dataset.export ?? ""]?.(item);
});
window.addEventListener("keydown", (e) => {
  const open = popovers.find((p) => !p.panel.hidden);
  if (e.key === "Escape" && open) {
    open.close(true);
    e.preventDefault();
  }
});
document.addEventListener("pointerdown", (e) => {
  for (const p of popovers) {
    const inside = p.panel.contains(e.target) || p.button.contains(e.target);
    if (!inside) p.close();
  }
});
window.addEventListener("resize", () => {
  for (const p of popovers) if (!p.panel.hidden) p.place();
});

// src/ui/ui.ts
var DRAG_FEEL = { rotateSpeed: 3, zoomSpeed: 1.2, panSpeed: 0.8, staticMoving: true };
Object.assign(controls, DRAG_FEEL);
function viewDirection(azimuthDeg, elevationDeg) {
  const a = THREE13.MathUtils.degToRad(azimuthDeg), e = THREE13.MathUtils.degToRad(elevationDeg);
  return new THREE13.Vector3(Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e));
}
var VIEWS = {
  a: () => viewFrom(lattice[0], lattice[2]),
  b: () => viewFrom(lattice[1], lattice[2]),
  c: () => viewFrom(lattice[2], lattice[1]),
  rotated: () => viewFrom(viewDirection(LOOK.azimuth, LOOK.elevation), new THREE13.Vector3(0, 0, 1))
};
for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => VIEWS[button.dataset.view ?? ""]());
}
var ORTHO_LENS = Infinity;
var ORTHO_TAG = "inf";
var FIT_EPSILON = 1e-9;
var lensGroup = byId("lens-group");
function isLensOn(button) {
  const value = button.dataset.lens;
  return value === ORTHO_TAG ? !isPersp() : isPersp() && Number(value) === lens;
}
function syncLensButtons() {
  for (const button of lensGroup.querySelectorAll("[data-lens]")) {
    button.setAttribute("aria-pressed", String(isLensOn(button)));
  }
}
function switchProjection(mode2, newLens = lens) {
  if (mode2 === "persp" === isPersp() && newLens === lens) return;
  const view = captureView();
  setLens(newLens);
  installCamera(mode2 === "persp" ? perspCamera : orthoCamera, view);
  syncLensButtons();
  requestRender();
}
function captureView() {
  const target = controls.target.clone();
  return {
    target,
    direction: camera.position.clone().sub(target).normalize(),
    orthoZoom: isPersp() ? perspToOrthoZoom(extent, lens, currentZoom()) : camera.zoom,
    fitted: Math.abs(shownZoom() - fitValue) < FIT_EPSILON
  };
}
function installCamera(next, view) {
  const persp = next instanceof THREE13.PerspectiveCamera;
  next.up.copy(camera.up);
  setCamera(next);
  camera.add(key, key.target);
  controls.object = camera;
  camera.position.copy(view.target).addScaledVector(view.direction, cameraDistance(persp, view.orthoZoom));
  if (!persp) camera.zoom = view.orthoZoom;
  camera.lookAt(view.target);
  resize();
  if (view.fitted) setZoom(fitFor(stage.clientWidth, stage.clientHeight));
  setFitValue(fitFor(stage.clientWidth, stage.clientHeight));
}
function cameraDistance(persp, orthoZoom) {
  if (persp) return baseDistance(extent) / orthoToPerspZoom(extent, lens, orthoZoom);
  return extent * ORTHO_VIEW_DISTANCE;
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
  button.addEventListener("click", () => ortho ? switchProjection("ortho") : switchProjection("persp", focalLength));
  if (ortho) lensGroup.insertAdjacentHTML("beforeend", '<span class="unit">mm</span>');
  lensGroup.appendChild(button);
}
for (const focalLength of [...GEMMY.lenses, ORTHO_LENS]) addLensButton(focalLength);
syncLensButtons();
var MS_PER_SECOND2 = 1e3;
var MAX_FRAME_SECONDS = 0.05;
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
    const move = amount.held ? RATE.pan * amount.seconds : STEP.pan;
    pan(Number(button.dataset.dx), Number(button.dataset.dy), move);
  } else if (kind === "zoom") {
    const factor = amount.held ? RATE.zoom ** amount.seconds : STEP.zoom;
    zoom(factor ** sign);
  } else if (kind === "fit") {
    fit();
  }
}
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
    const tick = (t) => {
      if (!press2) return;
      if (press2.last) act(button, { held: true, seconds: Math.min((t - press2.last) / MS_PER_SECOND2, MAX_FRAME_SECONDS) });
      press2.last = t;
      press2.frame = requestAnimationFrame(tick);
    };
    press2.frame = requestAnimationFrame(tick);
  };
  button.addEventListener("pointerdown", (e) => {
    if (isRotateButton(button)) beginRotation();
    const touch = e.pointerType === "touch";
    if (!touch) {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      act(button, CLICK);
    }
    press2 = { touch, last: 0, repeating: false, timer: 0, frame: 0 };
    if (button.dataset.act === "fit") return;
    press2.timer = window.setTimeout(repeatWhileHeld, HOLD_DELAY_MS);
  });
  button.addEventListener("pointerup", () => {
    if (press2?.touch && !press2.repeating) act(button, CLICK);
    stop();
  });
  for (const ev of ["pointercancel", "lostpointercapture"]) button.addEventListener(ev, stop);
  button.addEventListener("click", (e) => {
    if (e.detail !== 0) return;
    if (isRotateButton(button)) beginRotation();
    act(button, CLICK);
  });
}
for (const button of document.querySelectorAll("[data-act]")) wirePressButton(button);
var EDGE_SLACK_PX = 2;
var scrollers = [...document.querySelectorAll(".island, .tabs")];
function markOverflow(el2) {
  const { scrollLeft, scrollWidth, clientWidth } = el2;
  el2.classList.toggle("more-left", scrollLeft > EDGE_SLACK_PX);
  el2.classList.toggle("more-right", scrollLeft + clientWidth < scrollWidth - EDGE_SLACK_PX);
}
for (const el2 of scrollers) el2.addEventListener("scroll", () => markOverflow(el2), { passive: true });
window.addEventListener("resize", () => scrollers.forEach(markOverflow));
scrollers.forEach(markOverflow);
document.querySelector(".tabs [aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
var TIP_DELAY_MS = 300;
var TIP_GAP_PX = 8;
var tip = Object.assign(document.createElement("div"), { id: "tip", role: "tooltip" });
document.body.appendChild(tip);
var tipTimer = 0;
function hideTip() {
  window.clearTimeout(tipTimer);
  tip.classList.remove("on");
}
function showTip(el2) {
  tip.textContent = el2.dataset.tip ?? "";
  placeTip(el2);
  tip.classList.add("on");
}
function placeTip(el2) {
  const r = el2.getBoundingClientRect(), t = tip.getBoundingClientRect();
  const [x, y] = el2.closest("#bottom") ? tipBesideLeftColumn(r, t) : tipCentredVertically(r, t);
  tip.style.left = `${clamp(x, TIP_GAP_PX, innerWidth - t.width - TIP_GAP_PX)}px`;
  tip.style.top = `${clamp(y, TIP_GAP_PX, innerHeight - t.height - TIP_GAP_PX)}px`;
}
function tipBesideLeftColumn(r, t) {
  return [r.right + TIP_GAP_PX, r.top + r.height / 2 - t.height / 2];
}
function tipCentredVertically(r, t) {
  const x = r.left + r.width / 2 - t.width / 2;
  const y = r.top < innerHeight / 2 ? r.bottom + TIP_GAP_PX : r.top - TIP_GAP_PX - t.height;
  return [x, y];
}
document.addEventListener("pointerover", (e) => {
  const el2 = closestOf(e.target, "[title], [data-tip]");
  if (!el2 || e.pointerType === "touch") return;
  if (el2.hasAttribute("title")) {
    el2.dataset.tip = el2.title;
    el2.removeAttribute("title");
  }
  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => showTip(el2), TIP_DELAY_MS);
});
document.addEventListener("pointerout", (e) => {
  if (closestOf(e.target, "[data-tip]")) hideTip();
});
for (const ev of ["pointerdown", "keydown", "wheel"]) document.addEventListener(ev, hideTip, { passive: true });
function arrow(dx, dy, shift) {
  if (shift) pan(dx, dy, STEP.pan);
  else if (dy) rotate("x", dy * STEP.rotate);
  else rotate("y", -dx * STEP.rotate);
}
var KEY_ACTIONS = {
  ArrowUp: (shift) => arrow(0, 1, shift),
  ArrowDown: (shift) => arrow(0, -1, shift),
  ArrowLeft: (shift) => arrow(-1, 0, shift),
  ArrowRight: (shift) => arrow(1, 0, shift),
  "+": () => zoom(STEP.zoom),
  "=": () => zoom(STEP.zoom),
  "-": () => zoom(1 / STEP.zoom),
  "_": () => zoom(1 / STEP.zoom),
  "0": () => fit(),
  "[": () => rotate("z", -STEP.rotate),
  "]": () => rotate("z", STEP.rotate),
  t: cycleTheme
  // Auto → Light → Dark
};
function isTurnKey(e) {
  return e.key.startsWith("Arrow") && !e.shiftKey || e.key === "[" || e.key === "]";
}
function isTyping(e) {
  return closestOf(e.target, "input, textarea, .popover") !== null || e.metaKey || e.ctrlKey || e.altKey;
}
function runShortcut(e) {
  if (e.key === "?") {
    helpPopover.toggle();
    return true;
  }
  if (e.key === "i" && !e.shiftKey) {
    toggleInfo();
    return true;
  }
  if (FLY[e.code]) {
    flying.add(e.code);
    return true;
  }
  if (!Object.hasOwn(KEY_ACTIONS, e.key)) return false;
  KEY_ACTIONS[e.key](e.shiftKey);
  return true;
}
var escapeClosesMenu = false;
window.addEventListener("keydown", (e) => {
  escapeClosesMenu = e.key === "Escape" && document.querySelector(".popover:not([hidden])") !== null;
}, { capture: true });
window.addEventListener("keydown", (e) => {
  setShiftHeld(e.shiftKey);
  if (e.key === "Escape" && !escapeClosesMenu && closeUrlForm()) return;
  if (isTyping(e)) return;
  if (e.key === "Escape") {
    if (!escapeClosesMenu) {
      select(null);
      releasePivot();
    }
    return;
  }
  if (isTurnKey(e) && !e.repeat) beginRotation();
  if (runShortcut(e)) e.preventDefault();
});
function wireShowToggle(id, apply) {
  const button = byId(id);
  button.addEventListener("click", () => {
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    apply(on);
    requestRender();
  });
}
wireShowToggle("toggle-atoms", (on) => {
  show.atoms = on;
  atomGroup.visible = on;
});
wireShowToggle("toggle-outline", (on) => {
  setOutlines(on);
  outlineGroup.visible = on;
});
wireShowToggle("toggle-box", (on) => {
  show.box = on;
  if (box) box.visible = on;
});

// src/scene/load.ts
import * as THREE14 from "three";
function load(doc, bounds) {
  disposeScene();
  select(null);
  setData(doc);
  setPoints(new Map(doc.points.map((p) => [p.id, p])));
  setPolyhedra(doc.primitives.polyhedra);
  frame2(bounds, doc.cell);
  addAtomsBondsAndArrows();
  addPolyhedra2();
  addCellBox(doc.cell);
  resize();
}
function frame2(bounds, cell) {
  setCentre(bounds.centre);
  setExtent(bounds.extent);
  if (cell) setLattice(cell.vectors.map((vec) => new THREE14.Vector3(...vec).normalize()));
  root.position.set(-centre[0], -centre[1], -centre[2]);
  orthoCamera.far = extent * ORTHO_FAR_EXTENTS;
  controls.minDistance = baseDistance(extent) / ZOOM_MAX;
  controls.maxDistance = baseDistance(extent) / ZOOM_MIN;
}
function addAtomsBondsAndArrows() {
  setAtomGroup(new THREE14.Group());
  const bondGroup = new THREE14.Group();
  setOutlineGroup(new THREE14.Group());
  outlineGroup.visible = outlines;
  const shapes = /* @__PURE__ */ new Map();
  for (const g of instanceGroups(data)) {
    const shapeName = g.shape;
    let shape = shapes.get(shapeName);
    if (!shape) {
      shape = SHAPES[shapeName]();
      shapes.set(shapeName, shape);
    }
    const mesh = instanced(shape, toon(g.material), g.matrices);
    const isAtom = g.shape === "sphere";
    (isAtom ? atomGroup : bondGroup).add(mesh);
    if (isAtom) mesh.userData = { atoms: g.refs };
    if (g.outlined) outlineGroup.add(outlineOf(mesh));
  }
  atomGroup.visible = show.atoms;
  root.add(atomGroup, bondGroup, outlineGroup);
}
function addPolyhedra2() {
  setPolyGroup(new THREE14.Group());
  setPolyTargets(new Array(polyhedra.length));
  for (const g of polyhedronGroups(data)) {
    const ghost = (data.materials[g.material].alpha ?? 1) < 1;
    const geometry = new THREE14.BufferGeometry();
    geometry.setAttribute("position", new THREE14.Float32BufferAttribute(g.positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE14.Mesh(geometry, toon(g.material, { faces: true, ghost }));
    mesh.userData = { owner: g.owner };
    if (ghost) mesh.renderOrder = 1;
    for (const [index, first, count2] of g.ranges) {
      polyTargets[index] = { kind: "polyhedron", poly: polyhedra[index], ghost, mesh, first, count: count2 };
    }
    const edgeGeometry = new THREE14.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE14.Float32BufferAttribute(g.edges, 3));
    polyGroup.add(mesh, new THREE14.LineSegments(edgeGeometry, edgeMaterial));
    if (!ghost) outlineGroup.add(outlineOf(mesh));
  }
  root.add(polyGroup);
}
function addCellBox(cell) {
  setBox(null);
  if (!cell) return;
  const positions = [];
  const corners = Array.from({ length: 8 }, (_, n) => cellCorner(cell, n));
  for (let n = 0; n < 8; n++) {
    for (let axis = 0; axis < 3; axis++) {
      const bit = 1 << axis;
      if (n & bit) continue;
      positions.push(...corners[n], ...corners[n | bit]);
    }
  }
  const boxGeometry = new THREE14.BufferGeometry();
  boxGeometry.setAttribute("position", new THREE14.Float32BufferAttribute(positions, 3));
  const cellBox = new THREE14.LineSegments(boxGeometry, boxMaterial);
  setBox(cellBox);
  cellBox.visible = show.box;
  root.add(cellBox);
}
function cellCorner(cell, n) {
  const [a, b, c] = cell.vectors;
  return [0, 1, 2].map(
    (d) => cell.origin[d] + (n & 1) * a[d] + (n >> 1 & 1) * b[d] + (n >> 2 & 1) * c[d]
  );
}

// src/camera/viewhash.ts
var VIEW_KEY2 = "view";
var SIGNIFICANT_DIGITS = 4;
var FIELD_SEPARATOR = ";";
var VECTOR_SEPARATOR = ",";
var VECTOR_LENGTH = 3;
function roundFigures(x) {
  return Number(x.toPrecision(SIGNIFICANT_DIGITS));
}
var numberText = (x) => String(roundFigures(x));
var vectorText = (v) => v.map(numberText).join(VECTOR_SEPARATOR);
function encodeView(pose) {
  const size = pose.projection === "persp" ? `lens=${numberText(pose.lens)}` : `zoom=${numberText(pose.zoom)}`;
  return [pose.projection, size, `eye=${vectorText(pose.eye)}`, `at=${vectorText(pose.at)}`, `up=${vectorText(pose.up)}`].join(FIELD_SEPARATOR);
}
function decodeView(text) {
  const [projection, ...rest] = text.split(FIELD_SEPARATOR);
  if (projection !== "persp" && projection !== "ortho") return null;
  const fields = new URLSearchParams(rest.join("&"));
  const vector2 = (name) => {
    const parts = (fields.get(name) ?? "").split(VECTOR_SEPARATOR).map(Number);
    return parts.length === VECTOR_LENGTH && parts.every(Number.isFinite) ? parts : null;
  };
  const size = Number(fields.get(projection === "persp" ? "lens" : "zoom"));
  const eye = vector2("eye"), at = vector2("at"), up = vector2("up");
  if (!(size > 0) || !Number.isFinite(size) || !eye || !at || !up) return null;
  return {
    projection,
    lens: projection === "persp" ? size : 0,
    zoom: projection === "ortho" ? size : 1,
    eye,
    at,
    up
  };
}
function placedPose(pose, extent3, limits) {
  const numbers = [...pose.eye, ...pose.at, ...pose.up, pose.zoom];
  if (!numbers.every(Number.isFinite)) return null;
  const separation = span(pose.eye, pose.at);
  if (separation === 0 || Math.hypot(...pose.up) === 0) return null;
  const direction = vunit(vsub(pose.eye, pose.at));
  const distance2 = pose.projection === "ortho" ? extent3 * ORTHO_VIEW_DISTANCE : Math.min(Math.max(separation, limits.minDistance), limits.maxDistance);
  return {
    eye: vadd(pose.at, vscale(direction, distance2)),
    at: [...pose.at],
    up: vunit(pose.up),
    zoom: pose.zoom
  };
}

// src/ui/toast.ts
var DEFAULT_MS = 6e3;
var toast = byId("toast");
function note(text, ms = DEFAULT_MS) {
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, ms);
}

// src/ui/share.ts
var SETTLE_MS = 200;
var NOTE_MS = 5e3;
var vector = (v) => [v.x, v.y, v.z];
function currentPose() {
  return {
    projection: isPersp() ? "persp" : "ortho",
    lens,
    zoom: camera.zoom,
    eye: vector(camera.position),
    at: vector(controls.target),
    up: vector(camera.up)
  };
}
function applyPose(pose) {
  const placed = placedPose(pose, extent, controls);
  if (!placed) {
    VIEWS.rotated();
    return;
  }
  switchProjection(pose.projection, pose.projection === "persp" ? pose.lens : lens);
  camera.position.fromArray(placed.eye);
  controls.target.fromArray(placed.at);
  camera.up.fromArray(placed.up);
  camera.lookAt(controls.target);
  if (pose.projection === "ortho") {
    camera.zoom = placed.zoom;
    camera.updateProjectionMatrix();
  }
  writeAddress(encodeView(currentPose()));
  requestRender();
}
var pending = readAddressPose();
function readAddressPose() {
  const text = new URLSearchParams(location.hash.slice(1)).get(VIEW_KEY2);
  return text === null ? null : decodeView(text);
}
function takePendingPose() {
  const pose = pending;
  pending = null;
  return pose;
}
function writeAddress(text) {
  const url = new URL(location.href);
  url.hash = `${VIEW_KEY2}=${text}`;
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
  url.hash = `${VIEW_KEY2}=${encodeView(currentPose())}`;
  const said = sceneLink === null ? "Copied the view only: an embedded or local scene cannot go in a link, so the link opens this page at this view." : "Copied the link: this scene, at this view.";
  const refused = () => note("Could not copy the link: the browser refused the clipboard.", NOTE_MS);
  try {
    navigator.clipboard.writeText(url.href).then(() => note(said, NOTE_MS), refused);
  } catch {
    refused();
  }
}
byId("copy-link").addEventListener("click", copyLink);

// src/main.ts
function openScene(doc, view = null) {
  load(doc, sceneBounds(doc));
  if (view) applyPose(view);
  else VIEWS.rotated();
  const middle = [...polyTargets].sort((p, q) => dist(points.get(p.poly.center_point_id).position, centre) - dist(points.get(q.poly.center_point_id).position, centre))[0];
  select(middle ?? null);
  showInfo(infoChoice ?? (Boolean(middle) && !narrowScreen.matches));
  watchView();
}
function showLoaded(shown2) {
  setSceneLink(shown2.link);
  openScene(shown2.doc, takePendingPose());
  document.querySelector(".name h1").textContent = shown2.name;
  document.querySelector(".name .sub").textContent = shown2.from;
  document.title = `gemmy: ${shown2.name}`;
}
var embedded = document.getElementById("scene-data").textContent.trim();
var mode = document.querySelector('meta[name="gemmy-mode"]')?.content;
var following = mode === "live";
function showDropped(shown2) {
  following = false;
  showLoaded(shown2);
  const note2 = document.getElementById("follow-note");
  note2.textContent = `Showing ${shown2.name} \u2014 reload to follow the server again`;
  note2.hidden = false;
  document.getElementById("banner").hidden = false;
}
if (embedded) {
  openScene(JSON.parse(embedded), takePendingPose());
} else if (mode === "live") {
  describe(null);
  resize();
  const banner = document.getElementById("banner");
  const errorLine = banner.querySelector(".err"), toast2 = document.getElementById("toast");
  const followNote = document.getElementById("follow-note");
  const openUrl = document.getElementById("open-url");
  openUrl.disabled = true;
  openUrl.title = "Not on a gemmy serve page: it has no loader for an address (drop a file, or Open scene\u2026)";
  let seen = null, opened = false, renderedAt, toastTimer;
  const showToast = (text, stay) => {
    clearTimeout(toastTimer);
    toast2.textContent = text;
    toast2.hidden = false;
    toast2.classList.remove("fade");
    if (!stay) toastTimer = setTimeout(() => {
      toast2.classList.add("fade");
      toastTimer = setTimeout(() => {
        toast2.hidden = true;
      }, 400);
    }, 3e3);
  };
  const renderViewItem = exportMenu.querySelector('[data-export="render-view"]');
  EXPORTS["render-view"] = async () => {
    exportPopover.close(true);
    try {
      const response = await fetch("render-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: settingsJson(currentView())
      });
      const reply = await response.json();
      if (response.ok) showToast("Render queued with this view");
      else showToast(`Could not use this view: ${reply.error}`, true);
    } catch (error) {
      showToast(`Could not use this view: ${error}`, true);
    }
  };
  const showStatus = (s) => {
    const r = s.render;
    renderViewItem.hidden = !r?.enabled;
    errorLine.textContent = [s.error, r?.error ? `Blender error: ${r.error}` : ""].filter(Boolean).join("\n\n");
    errorLine.hidden = !errorLine.textContent;
    banner.hidden = errorLine.hidden && followNote.hidden;
    if (r?.state === "rendering") showToast(`Rendering ${r.output}\u2026`, true);
    else if (r?.time && r.time !== renderedAt && renderedAt !== void 0) showToast(`${r.output} updated`);
    else if (toast2.textContent.startsWith("Rendering")) toast2.hidden = true;
    renderedAt = r?.time ?? null;
  };
  const refresh = async () => {
    try {
      const response = await fetch("scene.json", { cache: "no-store" });
      if (!response.ok) return;
      const doc = await response.json();
      if (opened) {
        load(doc, sceneBounds(doc));
        requestRender();
      } else {
        openScene(doc, takePendingPose());
        opened = true;
      }
    } catch (error) {
      errorLine.textContent = String(error);
      errorLine.hidden = banner.hidden = false;
    }
  };
  const events = new EventSource("events");
  events.addEventListener("status", (e) => {
    const s = JSON.parse(e.data);
    showStatus(s);
    if (following && s.version && s.version !== seen) {
      seen = s.version;
      refresh();
    }
  });
} else {
  startLoader(showLoaded);
}
attachOpeners((shown2) => mode === "live" ? showDropped(shown2) : showLoaded(shown2));
