#!/usr/bin/env node
/**
 * HTTP wrapper for Slack MCP Server
 * Exposes Slack MCP functionality via HTTP REST API
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from 'dotenv';

// Load environment variables
config();
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
// Import SlackClient from index.ts - we'll need to extract it or define it here
// For now, let's define it inline since it's in the same file structure
class SlackClient {
  private botHeaders: { Authorization: string; "Content-Type": string };

  constructor(botToken: string) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
  }

  async getChannels(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({
      types: "public_channel",
      exclude_archived: "true",
      limit: Math.min(limit, 200).toString(),
      team_id: process.env.SLACK_TEAM_ID!,
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    const response = await fetch(
      `https://slack.com/api/conversations.list?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }

  async postMessage(channel_id: string, text: string): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        text: text,
      }),
    });

    return response.json();
  }

  async postReply(
    channel_id: string,
    thread_ts: string,
    text: string,
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        thread_ts: thread_ts,
        text: text,
      }),
    });

    return response.json();
  }

  async addReaction(
    channel_id: string,
    timestamp: string,
    reaction: string,
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        timestamp: timestamp,
        name: reaction,
      }),
    });

    return response.json();
  }

  async getChannelHistory(
    channel_id: string,
    limit: number = 10,
  ): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      limit: limit.toString(),
    });

    const response = await fetch(
      `https://slack.com/api/conversations.history?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }

  async getThreadReplies(channel_id: string, thread_ts: string): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      ts: thread_ts,
    });

    const response = await fetch(
      `https://slack.com/api/conversations.replies?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }

  async getUsers(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({
      limit: Math.min(limit, 200).toString(),
      team_id: process.env.SLACK_TEAM_ID!,
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    const response = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: this.botHeaders,
    });

    return response.json();
  }

  async getUserProfile(user_id: string): Promise<any> {
    const params = new URLSearchParams({
      user: user_id,
      include_labels: "true",
    });

    const response = await fetch(
      `https://slack.com/api/users.profile.get?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }
}

const app = express();
const port = parseInt(process.env.PORT || '3000');

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'slack-mcp-http',
    version: '1.0.0'
  });
});

// List available tools
app.get('/tools', async (req: Request, res: Response) => {
  try {
    res.json({
      result: [
        {
          name: "slack_list_channels",
          description: "List public channels in the Slack workspace",
          parameters: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Maximum number of channels to return (default: 100, max: 200)" },
              cursor: { type: "string", description: "Pagination cursor for next page" }
            }
          }
        },
        {
          name: "slack_post_message",
          description: "Post a new message to a Slack channel",
          parameters: {
            type: "object",
            required: ["channel_id", "text"],
            properties: {
              channel_id: { type: "string", description: "The ID of the channel to post to" },
              text: { type: "string", description: "The message text to post" }
            }
          }
        },
        {
          name: "slack_reply_to_thread",
          description: "Reply to a specific message thread",
          parameters: {
            type: "object",
            required: ["channel_id", "thread_ts", "text"],
            properties: {
              channel_id: { type: "string", description: "The channel containing the thread" },
              thread_ts: { type: "string", description: "Timestamp of the parent message" },
              text: { type: "string", description: "The reply text" }
            }
          }
        },
        {
          name: "slack_add_reaction",
          description: "Add an emoji reaction to a message",
          parameters: {
            type: "object",
            required: ["channel_id", "timestamp", "reaction"],
            properties: {
              channel_id: { type: "string", description: "The channel containing the message" },
              timestamp: { type: "string", description: "Message timestamp to react to" },
              reaction: { type: "string", description: "Emoji name without colons" }
            }
          }
        },
        {
          name: "slack_get_channel_history",
          description: "Get recent messages from a channel",
          parameters: {
            type: "object",
            required: ["channel_id"],
            properties: {
              channel_id: { type: "string", description: "The channel ID" },
              limit: { type: "number", description: "Number of messages to retrieve (default: 10)" }
            }
          }
        },
        {
          name: "slack_get_thread_replies",
          description: "Get all replies in a message thread",
          parameters: {
            type: "object",
            required: ["channel_id", "thread_ts"],
            properties: {
              channel_id: { type: "string", description: "The channel containing the thread" },
              thread_ts: { type: "string", description: "Timestamp of the parent message" }
            }
          }
        },
        {
          name: "slack_get_users",
          description: "Get list of workspace users with basic profile information",
          parameters: {
            type: "object",
            properties: {
              cursor: { type: "string", description: "Pagination cursor for next page" },
              limit: { type: "number", description: "Maximum users to return (default: 100, max: 200)" }
            }
          }
        },
        {
          name: "slack_get_user_profile",
          description: "Get detailed profile information for a specific user",
          parameters: {
            type: "object",
            required: ["user_id"],
            properties: {
              user_id: { type: "string", description: "The user's ID" }
            }
          }
        }
      ]
    });
  } catch (error: any) {
    console.error('Error listing tools:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute a tool
app.post('/execute', async (req: Request, res: Response) => {
  try {
    const { tool_name, arguments: args } = req.body;
    
    if (!tool_name) {
      return res.status(400).json({ error: 'tool_name is required' });
    }

    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) {
      return res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' });
    }

    const slackClient = new SlackClient(botToken);
    let result;

    switch (tool_name) {
      case "slack_list_channels": {
        const response = await slackClient.getChannels(args?.limit, args?.cursor);
        result = { result: response };
        break;
      }
      case "slack_post_message": {
        if (!args?.channel_id || !args?.text) {
          return res.status(400).json({ error: 'channel_id and text are required' });
        }
        const response = await slackClient.postMessage(args.channel_id, args.text);
        result = { result: response };
        break;
      }
      case "slack_reply_to_thread": {
        if (!args?.channel_id || !args?.thread_ts || !args?.text) {
          return res.status(400).json({ error: 'channel_id, thread_ts, and text are required' });
        }
        const response = await slackClient.postReply(args.channel_id, args.thread_ts, args.text);
        result = { result: response };
        break;
      }
      case "slack_add_reaction": {
        if (!args?.channel_id || !args?.timestamp || !args?.reaction) {
          return res.status(400).json({ error: 'channel_id, timestamp, and reaction are required' });
        }
        const response = await slackClient.addReaction(args.channel_id, args.timestamp, args.reaction);
        result = { result: response };
        break;
      }
      case "slack_get_channel_history": {
        if (!args?.channel_id) {
          return res.status(400).json({ error: 'channel_id is required' });
        }
        const response = await slackClient.getChannelHistory(args.channel_id, args?.limit);
        result = { result: response };
        break;
      }
      case "slack_get_thread_replies": {
        if (!args?.channel_id || !args?.thread_ts) {
          return res.status(400).json({ error: 'channel_id and thread_ts are required' });
        }
        const response = await slackClient.getThreadReplies(args.channel_id, args.thread_ts);
        result = { result: response };
        break;
      }
      case "slack_get_users": {
        const response = await slackClient.getUsers(args?.limit, args?.cursor);
        result = { result: response };
        break;
      }
      case "slack_get_user_profile": {
        if (!args?.user_id) {
          return res.status(400).json({ error: 'user_id is required' });
        }
        const response = await slackClient.getUserProfile(args.user_id);
        result = { result: response };
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown tool: ${tool_name}` });
    }

    res.json(result);
  } catch (error: any) {
    console.error('Error executing tool:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Slack MCP HTTP Server running on port ${port}`);
  console.log(`📝 Health check: http://localhost:${port}/health`);
  console.log(`🔧 Tools: http://localhost:${port}/tools`);
  console.log(`⚡ Execute: POST http://localhost:${port}/execute`);
});

