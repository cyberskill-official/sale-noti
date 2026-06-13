"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreUnsupportedDeal = exports.scoreDeal = exports.normalizeDealScoreMarket = exports.isDealScoreMarket = exports.extractDealScoreWindow = void 0;
__exportStar(require("./model"), exports);
var features_1 = require("./features");
Object.defineProperty(exports, "extractDealScoreWindow", { enumerable: true, get: function () { return features_1.extractDealScoreWindow; } });
Object.defineProperty(exports, "isDealScoreMarket", { enumerable: true, get: function () { return features_1.isDealScoreMarket; } });
Object.defineProperty(exports, "normalizeDealScoreMarket", { enumerable: true, get: function () { return features_1.normalizeDealScoreMarket; } });
Object.defineProperty(exports, "scoreDeal", { enumerable: true, get: function () { return features_1.scoreDeal; } });
Object.defineProperty(exports, "scoreUnsupportedDeal", { enumerable: true, get: function () { return features_1.scoreUnsupportedDeal; } });
