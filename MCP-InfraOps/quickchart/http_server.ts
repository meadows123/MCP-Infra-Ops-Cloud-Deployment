#!/usr/bin/env node
/**
 * HTTP REST API wrapper for QuickChart MCP Server
 * Exposes QuickChart functionality via HTTP endpoints for the orchestrator and Front-End to call
 */

import express from 'express';
import cors from 'cors';

interface ChartConfig {
  type: string;
  data: {
    labels?: string[];
    datasets: Array<{
      label?: string;
      data: number[];
      backgroundColor?: string | string[];
      borderColor?: string | string[];
      [key: string]: any;
    }>;
    [key: string]: any;
  };
  options?: {
    title?: {
      display: boolean;
      text: string;
    };
    [key: string]: any;
  };
}

const QUICKCHART_BASE_URL = 'https://quickchart.io/chart';

interface GenerateChartRequest {
  type: string;
  labels?: string[];
  datasets: Array<{
    label?: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    [key: string]: any;
  }>;
  title?: string;
  options?: Record<string, any>;
}

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'QuickChart HTTP Server',
    endpoint: '/generate'
  });
});

// Generate chart endpoint
app.post('/generate', (req, res) => {
  console.log(`[QuickChart] Received chart generation request: type=${req.body?.type}, labels=${req.body?.labels?.length || 0}, datasets=${req.body?.datasets?.length || 0}`);
  try {
    const { type, labels, datasets, title, options = {} }: GenerateChartRequest = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Chart type is required' });
    }

    if (!datasets || !Array.isArray(datasets) || datasets.length === 0) {
      return res.status(400).json({ error: 'Datasets array is required' });
    }

    // Validate chart type
    const validTypes = ['bar', 'line', 'pie', 'doughnut', 'radar', 'polarArea', 'scatter', 'bubble', 'radialGauge', 'speedometer'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ 
        error: `Invalid chart type. Valid types: ${validTypes.join(', ')}` 
      });
    }

    // Build Chart.js configuration
    const config: ChartConfig = {
      type,
      data: {
        labels: labels || [],
        datasets: datasets.map(dataset => ({
          label: dataset.label || '',
          backgroundColor: dataset.backgroundColor,
          borderColor: dataset.borderColor,
          ...dataset
        }))
      },
      options: {
        ...options,
        ...(title && {
          title: {
            display: true,
            text: title
          }
        }),
        responsive: true,
        maintainAspectRatio: true
      }
    };

    // Generate chart URL
    const encodedConfig = encodeURIComponent(JSON.stringify(config));
    const chartUrl = `${QUICKCHART_BASE_URL}?c=${encodedConfig}`;

    console.log(`[QuickChart] Generated chart URL: ${chartUrl.substring(0, 100)}...`);

    res.json({
      status: 'success',
      chartUrl,
      config
    });

  } catch (error: any) {
    console.error('Error generating chart:', error);
    res.status(500).json({
      status: 'error',
      error: error.message || 'Failed to generate chart'
    });
  }
});

// Execute tool endpoint (for MCP compatibility)
app.post('/execute', (req, res) => {
  try {
    const { tool, arguments: args } = req.body;

    if (!tool) {
      return res.status(400).json({ error: 'Tool name is required' });
    }

    if (tool === 'generate_chart') {
      // Map MCP tool format to HTTP format
      const { type, labels, datasets, title, options } = args;
      
      if (!type || !datasets) {
        return res.status(400).json({ error: 'Type and datasets are required' });
      }

      const config: ChartConfig = {
        type,
        data: {
          labels: labels || [],
          datasets: datasets.map((dataset: any) => ({
            label: dataset.label || '',
            backgroundColor: dataset.backgroundColor,
            borderColor: dataset.borderColor,
            ...dataset
          }))
        },
        options: {
          ...options,
          ...(title && {
            title: {
              display: true,
              text: title
            }
          }),
          responsive: true,
          maintainAspectRatio: true
        }
      };

      const encodedConfig = encodeURIComponent(JSON.stringify(config));
      const chartUrl = `${QUICKCHART_BASE_URL}?c=${encodedConfig}`;

      return res.json({
        status: 'success',
        result: {
          chartUrl,
          config
        }
      });
    }

    res.status(400).json({ error: `Unknown tool: ${tool}` });

  } catch (error: any) {
    console.error('Error executing tool:', error);
    res.status(500).json({
      status: 'error',
      error: error.message || 'Failed to execute tool'
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`QuickChart HTTP Server running on port ${port}`);
});
