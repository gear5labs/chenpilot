import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import axios from 'axios';

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

/**
 * Price data point for chart generation
 */
export interface PriceDataPoint {
  timestamp: number;
  price: number;
}

/**
 * Chart generation options
 */
export interface ChartOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  lineColor?: string;
  showGrid?: boolean;
  showPoints?: boolean;
}

/**
 * Service for generating static price charts for assets
 */
export class PriceChartService {
  private chartRenderer: ChartJSNodeCanvas;
  private defaultWidth: number = 800;
  private defaultHeight: number = 400;

  constructor() {
    this.chartRenderer = new ChartJSNodeCanvas({
      width: this.defaultWidth,
      height: this.defaultHeight,
      chartCallback: (ChartJS: { defaults: { font: { family: string }; color: string } }) => {
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
  async fetchHistoricalPriceData(
    assetCode: string,
    currency: string = 'USD',
    days: number = 7
  ): Promise<PriceDataPoint[]> {
    try {
      const response = await axios.get(
        `${BACKEND_URL}/api/price/${assetCode}/history?currency=${currency}&days=${days}`
      );

      if (!response.data || !Array.isArray(response.data.data)) {
        // Fallback: generate mock data if API doesn't support history endpoint
        return this.generateMockPriceData(days);
      }

      return response.data.data.map((point: { timestamp: string; price: number }) => ({
        timestamp: new Date(point.timestamp).getTime(),
        price: point.price,
      }));
    } catch (error) {
      console.error(`Failed to fetch historical price data for ${assetCode}:`, error);
      // Fallback to mock data
      return this.generateMockPriceData(days);
    }
  }

  /**
   * Generate mock price data for testing/fallback
   * @param days - Number of days of data to generate
   * @returns Array of mock price data points
   */
  private generateMockPriceData(days: number): PriceDataPoint[] {
    const data: PriceDataPoint[] = [];
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
  async generateChart(
    assetCode: string,
    priceData: PriceDataPoint[],
    options: ChartOptions = {}
  ): Promise<Buffer> {
    const {
      width = this.defaultWidth,
      height = this.defaultHeight,
      lineColor = '#00d4ff',
      showGrid = true,
      showPoints = true,
    } = options;

    // Update renderer dimensions if custom size provided
    if (width !== this.defaultWidth || height !== this.defaultHeight) {
      this.chartRenderer = new ChartJSNodeCanvas({ width, height });
    }

    const labels = priceData.map(point => 
      new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );
    const prices = priceData.map(point => point.price);

    // Calculate price range for better visualization
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;
    const padding = priceRange * 0.1;

    const configuration = {
      type: 'line' as const,
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
                weight: 'bold' as const,
              },
            },
          },
          title: {
            display: true,
            text: `${assetCode} Price Chart`,
            color: '#ffffff',
            font: {
              size: 18,
              weight: 'bold' as const,
            },
          },
          tooltip: {
            mode: 'index' as const,
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
              callback: (value: string | number) => typeof value === 'number' ? `$${value.toFixed(4)}` : value,
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

    const imageBuffer = await this.chartRenderer.renderToBuffer(configuration);
    return imageBuffer;
  }

  /**
   * Generate a price chart with automatic data fetching
   * @param assetCode - The asset code
   * @param currency - The currency to quote in (default: USD)
   * @param days - Number of days of historical data (default: 7)
   * @param options - Chart generation options
   * @returns Buffer containing the chart image
   */
  async generatePriceChart(
    assetCode: string,
    currency: string = 'USD',
    days: number = 7,
    options: ChartOptions = {}
  ): Promise<Buffer> {
    const priceData = await this.fetchHistoricalPriceData(assetCode, currency, days);
    return this.generateChart(assetCode, priceData, options);
  }

  /**
   * Get current price for an asset
   * @param assetCode - The asset code
   * @param currency - The currency to quote in (default: USD)
   * @returns Current price
   */
  async getCurrentPrice(assetCode: string, currency: string = 'USD'): Promise<number> {
    try {
      const response = await axios.get(
        `${BACKEND_URL}/api/price/${assetCode}?currency=${currency}`
      );
      return response.data.price;
    } catch (error) {
      console.error(`Failed to fetch current price for ${assetCode}:`, error);
      throw new Error(`Could not fetch price for ${assetCode}`);
    }
  }

  /**
   * Get price change percentage over a period
   * @param assetCode - The asset code
   * @param currency - The currency to quote in (default: USD)
   * @param hours - Number of hours to calculate change over (default: 24)
   * @returns Price change percentage
   */
  async getPriceChange(
    assetCode: string,
    currency: string = 'USD',
    hours: number = 24
  ): Promise<number> {
    try {
      const priceData = await this.fetchHistoricalPriceData(assetCode, currency, Math.ceil(hours / 24));
      
      if (priceData.length < 2) {
        return 0;
      }

      const oldestPrice = priceData[0].price;
      const newestPrice = priceData[priceData.length - 1].price;
      
      return ((newestPrice - oldestPrice) / oldestPrice) * 100;
    } catch (error) {
      console.error(`Failed to calculate price change for ${assetCode}:`, error);
      return 0;
    }
  }
}
