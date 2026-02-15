#!/usr/bin/env node
/**
 * HTTP REST API wrapper for Sequential Thinking MCP Server
 * Exposes sequential thinking functionality via HTTP endpoints for the orchestrator
 */

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
}

class SequentialThinkingServer {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};

  private validateThoughtData(input: any): ThoughtData {
    if (!input.thought || typeof input.thought !== 'string') {
      throw new Error('Invalid thought: must be a string');
    }
    if (!input.thoughtNumber || typeof input.thoughtNumber !== 'number') {
      throw new Error('Invalid thoughtNumber: must be a number');
    }
    if (!input.totalThoughts || typeof input.totalThoughts !== 'number') {
      throw new Error('Invalid totalThoughts: must be a number');
    }
    if (typeof input.nextThoughtNeeded !== 'boolean') {
      throw new Error('Invalid nextThoughtNeeded: must be a boolean');
    }

    return {
      thought: input.thought,
      thoughtNumber: input.thoughtNumber,
      totalThoughts: input.totalThoughts,
      nextThoughtNeeded: input.nextThoughtNeeded,
      isRevision: input.isRevision,
      revisesThought: input.revisesThought,
      branchFromThought: input.branchFromThought,
      branchId: input.branchId,
      needsMoreThoughts: input.needsMoreThoughts,
    };
  }

  public processThought(input: any): { status: string; data: any } {
    try {
      const validatedInput = this.validateThoughtData(input);

      if (validatedInput.thoughtNumber > validatedInput.totalThoughts) {
        validatedInput.totalThoughts = validatedInput.thoughtNumber;
      }

      this.thoughtHistory.push(validatedInput);

      if (validatedInput.branchFromThought && validatedInput.branchId) {
        if (!this.branches[validatedInput.branchId]) {
          this.branches[validatedInput.branchId] = [];
        }
        this.branches[validatedInput.branchId].push(validatedInput);
      }

      return {
        status: 'success',
        data: {
          thoughtNumber: validatedInput.thoughtNumber,
          totalThoughts: validatedInput.totalThoughts,
          nextThoughtNeeded: validatedInput.nextThoughtNeeded,
          branches: Object.keys(this.branches),
          thoughtHistoryLength: this.thoughtHistory.length
        }
      };
    } catch (error: any) {
      return {
        status: 'error',
        data: {
          error: error.message
        }
      };
    }
  }

  public getThoughtHistory(): ThoughtData[] {
    return this.thoughtHistory;
  }

  public getBranches(): Record<string, ThoughtData[]> {
    return this.branches;
  }
}

const thinkingServer = new SequentialThinkingServer();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'sequential_thinking_mcp_server',
    thoughtHistoryLength: thinkingServer.getThoughtHistory().length
  });
});

// List available tools
app.get('/tools', (req, res) => {
  const tools = [
    {
      name: 'sequential_thinking',
      description: 'Process a sequential thought for problem-solving',
      parameters: {
        thought: 'string',
        thoughtNumber: 'number',
        totalThoughts: 'number',
        nextThoughtNeeded: 'boolean',
        isRevision: 'boolean (optional)',
        revisesThought: 'number (optional)',
        branchFromThought: 'number (optional)',
        branchId: 'string (optional)',
        needsMoreThoughts: 'boolean (optional)'
      }
    }
  ];
  res.json({ tools });
});

// Execute the sequential_thinking tool
app.post('/execute', (req, res) => {
  try {
    const { tool, arguments: args } = req.body;
    
    if (!tool) {
      return res.status(400).json({ error: 'Missing tool parameter' });
    }

    if (tool !== 'sequential_thinking') {
      return res.status(400).json({ error: `Unknown tool: ${tool}` });
    }

    const result = thinkingServer.processThought(args);
    res.json(result);
  } catch (error: any) {
    console.error('Error executing tool:', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Get thought history
app.get('/thought-history', (req, res) => {
  res.json({
    thoughtHistory: thinkingServer.getThoughtHistory(),
    branches: thinkingServer.getBranches()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sequential Thinking MCP HTTP Server listening on port ${PORT}`);
});
