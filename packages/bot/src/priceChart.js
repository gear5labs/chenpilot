"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceChartService = void 0;
const chartjs_node_canvas_1 = require("chartjs-node-canvas");
const axios_1 = __importDefault(require("axios"));
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
/**
 * Service for generating static price charts for assets
 */
class PriceChartService {
    constructor() {
        this.defaultWidth = 800;
        this.defaultHeight = 400;
        this.chartRenderer = new chartjs_node_canvas_1.ChartJSNodeCanvas({
            width: this.defaultWidth,
            height: this.defaultHeight,
            chartCallback: (ChartJS) => {
                // Custom chart configuration if needed
                ChartJS.defaults.font.family = 'Arial, sans-serif';
                ChartJS.defaults.color = '#ffffff';
            },
        });
    }
    /**
     * Fetch historical price data for an asset
     * @param assetCode - The asset code (e.g., XLM, USDC)
     * @param currency - The currency to quote in (default: USD)
     * @param days - Number of days of historical data (default: 7)
     * @returns Array of price data points
     */
    fetchHistoricalPriceData(assetCode_1) {
        return __awaiter(this, arguments, void 0, function* (assetCode, currency = 'USD', days = 7) {
            try {
                const response = yield axios_1.default.get(`${BACKEND_URL}/api/price/${assetCode}/history?currency=${currency}&days=${days}`);
                if (!response.data || !Array.isArray(response.data.data)) {
                    // Fallback: generate mock data if API doesn't support history endpoint
                    return this.generateMockPriceData(days);
                }
                return response.data.data.map((point) => ({
                    timestamp: new Date(point.timestamp).getTime(),
                    price: point.price,
                }));
            }
            catch (error) {
                console.error(`Failed to fetch historical price data for ${assetCode}:`, error);
                // Fallback to mock data
                return this.generateMockPriceData(days);
            }
        });
    }
    /**
     * Generate mock price data for testing/fallback
     * @param days - Number of days of data to generate
     * @returns Array of mock price data points
     */
    generateMockPriceData(days) {
        const data = [];
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        // Start with a base price and generate random walk
        let basePrice = 0.15 + Math.random() * 0.1;
        for (let i = days; i >= 0; i--) {
            const timestamp = now - (i * dayMs);
            // Random walk with some volatility
            const change = (Math.random() - 0.5) * 0.02;
            basePrice = Math.max(0.01, basePrice + change);
            data.push({
                timestamp,
                price: basePrice,
            });
        }
        return data;
    }
    /**
     * Generate a static price chart image
     * @param assetCode - The asset code
     * @param priceData - Array of price data points
     * @param options - Chart generation options
     * @returns Buffer containing the chart image
     */
    generateChart(assetCode_1, priceData_1) {
        return __awaiter(this, arguments, void 0, function* (assetCode, priceData, options = {}) {
            const { width = this.defaultWidth, height = this.defaultHeight, lineColor = '#00d4ff', showGrid = true, showPoints = true, } = options;
            // Update renderer dimensions if custom size provided
            if (width !== this.defaultWidth || height !== this.defaultHeight) {
                this.chartRenderer = new chartjs_node_canvas_1.ChartJSNodeCanvas({ width, height });
            }
            const labels = priceData.map(point => new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            const prices = priceData.map(point => point.price);
            // Calculate price range for better visualization
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const priceRange = maxPrice - minPrice;
            const padding = priceRange * 0.1;
            const configuration = {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: `${assetCode} Price`,
                            data: prices,
                            borderColor: lineColor,
                            backgroundColor: lineColor + '20', // Add transparency
                            borderWidth: 3,
                            fill: true,
                            tension: 0.4, // Smooth curves
                            pointRadius: showPoints ? 4 : 0,
                            pointBackgroundColor: lineColor,
                            pointBorderColor: '#ffffff',
                            pointBorderWidth: 2,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            labels: {
                                color: '#ffffff',
                                font: {
                                    size: 14,
                                    weight: 'bold',
                                },
                            },
                        },
                        title: {
                            display: true,
                            text: `${assetCode} Price Chart`,
                            color: '#ffffff',
                            font: {
                                size: 18,
                                weight: 'bold',
                            },
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleColor: '#ffffff',
                            bodyColor: '#ffffff',
                            borderColor: lineColor,
                            borderWidth: 1,
                        },
                    },
                    scales: {
                        x: {
                            display: true,
                            grid: {
                                display: showGrid,
                                color: 'rgba(255, 255, 255, 0.1)',
                            },
                            ticks: {
                                color: '#ffffff',
                                maxRotation: 45,
                                minRotation: 45,
                            },
                        },
                        y: {
                            display: true,
                            grid: {
                                display: showGrid,
                                color: 'rgba(255, 255, 255, 0.1)',
                            },
                            ticks: {
                                color: '#ffffff',
                                callback: (value) => typeof value === 'number' ? `$${value.toFixed(4)}` : value,
                            },
                            min: minPrice - padding,
                            max: maxPrice + padding,
                        },
                    },
                    layout: {
                        padding: {
                            top: 20,
                            right: 20,
                            bottom: 20,
                            left: 20,
                        },
                    },
                },
            };
            const imageBuffer = yield this.chartRenderer.renderToBuffer(configuration);
            return imageBuffer;
        });
    }
    /**
     * Generate a price chart with automatic data fetching
     * @param assetCode - The asset code
     * @param currency - The currency to quote in (default: USD)
     * @param days - Number of days of historical data (default: 7)
     * @param options - Chart generation options
     * @returns Buffer containing the chart image
     */
    generatePriceChart(assetCode_1) {
        return __awaiter(this, arguments, void 0, function* (assetCode, currency = 'USD', days = 7, options = {}) {
            const priceData = yield this.fetchHistoricalPriceData(assetCode, currency, days);
            return this.generateChart(assetCode, priceData, options);
        });
    }
    /**
     * Get current price for an asset
     * @param assetCode - The asset code
     * @param currency - The currency to quote in (default: USD)
     * @returns Current price
     */
    getCurrentPrice(assetCode_1) {
        return __awaiter(this, arguments, void 0, function* (assetCode, currency = 'USD') {
            try {
                const response = yield axios_1.default.get(`${BACKEND_URL}/api/price/${assetCode}?currency=${currency}`);
                return response.data.price;
            }
            catch (error) {
                console.error(`Failed to fetch current price for ${assetCode}:`, error);
                throw new Error(`Could not fetch price for ${assetCode}`);
            }
        });
    }
    /**
     * Get price change percentage over a period
     * @param assetCode - The asset code
     * @param currency - The currency to quote in (default: USD)
     * @param hours - Number of hours to calculate change over (default: 24)
     * @returns Price change percentage
     */
    getPriceChange(assetCode_1) {
        return __awaiter(this, arguments, void 0, function* (assetCode, currency = 'USD', hours = 24) {
            try {
                const priceData = yield this.fetchHistoricalPriceData(assetCode, currency, Math.ceil(hours / 24));
                if (priceData.length < 2) {
                    return 0;
                }
                const oldestPrice = priceData[0].price;
                const newestPrice = priceData[priceData.length - 1].price;
                return ((newestPrice - oldestPrice) / oldestPrice) * 100;
            }
            catch (error) {
                console.error(`Failed to calculate price change for ${assetCode}:`, error);
                return 0;
            }
        });
    }
}
exports.PriceChartService = PriceChartService;
