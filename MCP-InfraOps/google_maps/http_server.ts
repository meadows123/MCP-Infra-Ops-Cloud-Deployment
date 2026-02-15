#!/usr/bin/env node
/**
 * HTTP REST API wrapper for Google Maps MCP Server
 * Exposes Google Maps functionality via HTTP endpoints for the orchestrator and Front-End to call
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const port = parseInt(process.env.PORT || '3000');

app.use(cors());
app.use(express.json());

// Get API key from environment
function getApiKey(): string {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GOOGLE_MAPS_API_KEY environment variable is not set");
    process.exit(1);
  }
  return apiKey;
}

const GOOGLE_MAPS_API_KEY = getApiKey();

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'Google Maps HTTP Server',
    version: '0.1.0',
    api_key_configured: !!GOOGLE_MAPS_API_KEY
  });
});

// Geocode endpoint
app.post('/geocode', async (req: Request, res: Response) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    console.log(`[Google Maps] Geocoding address: ${address}`);

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.append('address', address);
    url.searchParams.append('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json() as any;

    if (data.status !== 'OK') {
      return res.status(400).json({
        error: `Geocoding failed: ${data.error_message || data.status}`,
        status: data.status
      });
    }

    const result = data.results[0];
    res.json({
      status: 'success',
      output: JSON.stringify({
        location: result.geometry.location,
        formatted_address: result.formatted_address,
        place_id: result.place_id,
      }, null, 2)
    });
  } catch (error: any) {
    console.error(`[Google Maps] Geocoding error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Reverse geocode endpoint
app.post('/reverse-geocode', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    console.log(`[Google Maps] Reverse geocoding coordinates: ${latitude}, ${longitude}`);

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.append('latlng', `${latitude},${longitude}`);
    url.searchParams.append('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json() as any;

    if (data.status !== 'OK') {
      return res.status(400).json({
        error: `Reverse geocoding failed: ${data.error_message || data.status}`,
        status: data.status
      });
    }

    const result = data.results[0];
    res.json({
      status: 'success',
      output: JSON.stringify({
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        address_components: result.address_components,
      }, null, 2)
    });
  } catch (error: any) {
    console.error(`[Google Maps] Reverse geocoding error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Elevation endpoint
app.post('/elevation', async (req: Request, res: Response) => {
  try {
    const { locations } = req.body;
    
    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ error: 'Locations array is required' });
    }

    console.log(`[Google Maps] Getting elevation for ${locations.length} location(s)`);

    // Build locations parameter (pipe-separated lat,lng pairs)
    const locationsStr = locations.map((loc: { latitude: number; longitude: number }) => 
      `${loc.latitude},${loc.longitude}`
    ).join('|');

    const url = new URL('https://maps.googleapis.com/maps/api/elevation/json');
    url.searchParams.append('locations', locationsStr);
    url.searchParams.append('key', GOOGLE_MAPS_API_KEY);

    const response = await fetch(url.toString());
    const data = await response.json() as any;

    if (data.status !== 'OK') {
      return res.status(400).json({
        error: `Elevation lookup failed: ${data.error_message || data.status}`,
        status: data.status
      });
    }

    res.json({
      status: 'success',
      output: JSON.stringify({
        results: data.results,
      }, null, 2)
    });
  } catch (error: any) {
    console.error(`[Google Maps] Elevation error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// MCP-compatible execute endpoint (used by orchestrator)
app.post('/execute', async (req: Request, res: Response) => {
  try {
    const { tool, arguments: args } = req.body;
    
    if (!tool) {
      return res.status(400).json({ error: 'Missing tool parameter' });
    }

    console.log(`[Google Maps] Executing tool: ${tool}`);

    switch (tool) {
      case 'maps_geocode': {
        if (!args.address) {
          return res.status(400).json({ error: 'Address is required for maps_geocode' });
        }
        // Call geocode endpoint logic
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        url.searchParams.append('address', args.address);
        url.searchParams.append('key', GOOGLE_MAPS_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json() as any;

        if (data.status !== 'OK') {
          return res.json({
            status: 'error',
            error: `Geocoding failed: ${data.error_message || data.status}`
          });
        }

        const result = data.results[0];
        return res.json({
          status: 'success',
          output: JSON.stringify({
            location: result.geometry.location,
            formatted_address: result.formatted_address,
            place_id: result.place_id,
          }, null, 2)
        });
      }

      case 'maps_reverse_geocode': {
        if (args.latitude === undefined || args.longitude === undefined) {
          return res.status(400).json({ error: 'Latitude and longitude are required for maps_reverse_geocode' });
        }
        // Call reverse geocode endpoint logic
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        url.searchParams.append('latlng', `${args.latitude},${args.longitude}`);
        url.searchParams.append('key', GOOGLE_MAPS_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json() as any;

        if (data.status !== 'OK') {
          return res.json({
            status: 'error',
            error: `Reverse geocoding failed: ${data.error_message || data.status}`
          });
        }

        const result = data.results[0];
        return res.json({
          status: 'success',
          output: JSON.stringify({
            formatted_address: result.formatted_address,
            place_id: result.place_id,
            address_components: result.address_components,
          }, null, 2)
        });
      }

      case 'maps_elevation': {
        if (!args.locations || !Array.isArray(args.locations) || args.locations.length === 0) {
          return res.status(400).json({ error: 'Locations array is required for maps_elevation' });
        }
        // Call elevation endpoint logic
        const locationsStr = args.locations.map((loc: { latitude: number; longitude: number }) => 
          `${loc.latitude},${loc.longitude}`
        ).join('|');

        const url = new URL('https://maps.googleapis.com/maps/api/elevation/json');
        url.searchParams.append('locations', locationsStr);
        url.searchParams.append('key', GOOGLE_MAPS_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json() as any;

        if (data.status !== 'OK') {
          return res.json({
            status: 'error',
            error: `Elevation lookup failed: ${data.error_message || data.status}`
          });
        }

        return res.json({
          status: 'success',
          output: JSON.stringify({
            results: data.results,
          }, null, 2)
        });
      }

      default:
        return res.status(400).json({ 
          error: `Unknown tool: ${tool}`,
          available_tools: ['maps_geocode', 'maps_reverse_geocode', 'maps_elevation']
        });
    }
  } catch (error: any) {
    console.error(`[Google Maps] Error executing tool: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Google Maps HTTP Server listening on port ${port}`);
  console.log(`✅ API key configured: ${!!GOOGLE_MAPS_API_KEY}`);
});
