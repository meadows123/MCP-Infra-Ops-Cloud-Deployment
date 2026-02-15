#!/usr/bin/env node
/**
 * HTTP REST API wrapper for Filesystem MCP Server
 * Exposes Filesystem functionality via HTTP endpoints for the orchestrator and Front-End to call
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { diffLines, createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';

const app = express();
const port = parseInt(process.env.PORT || '3000');

app.use(cors());
app.use(express.json());

// Get allowed directories from environment or use default
const PROJECTS_PATH = process.env.PROJECTS_PATH || '/projects';
const allowedDirectories = [PROJECTS_PATH];

// Normalize paths
function normalizePath(p: string): string {
  return path.normalize(p);
}

// Validate that path is within allowed directories
async function validatePath(filePath: string): Promise<string> {
  const normalized = normalizePath(filePath);
  const expanded = normalized.startsWith('~') 
    ? path.join(process.env.HOME || '', normalized.slice(1))
    : normalized;
  
  const absolutePath = path.isAbsolute(expanded) 
    ? expanded 
    : path.resolve(PROJECTS_PATH, expanded);
  
  // Check if path is within allowed directories
  const isAllowed = allowedDirectories.some(allowed => {
    const allowedPath = path.resolve(allowed);
    return absolutePath.startsWith(allowedPath);
  });
  
  if (!isAllowed) {
    throw new Error(`Path ${absolutePath} is not within allowed directories: ${allowedDirectories.join(', ')}`);
  }
  
  return absolutePath;
}

// File editing utilities
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

async function applyFileEdits(
  filePath: string,
  edits: Array<{oldText: string, newText: string}>,
  dryRun = false
): Promise<string> {
  const content = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));
  let modifiedContent = content;
  
  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);
    
    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }
    
    // Try line-by-line matching
    const oldLines = normalizedOld.split('\n');
    const contentLines = modifiedContent.split('\n');
    let matchFound = false;
    
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const potentialMatch = contentLines.slice(i, i + oldLines.length);
      const isMatch = oldLines.every((oldLine, j) => {
        return oldLine.trim() === potentialMatch[j].trim();
      });
      
      if (isMatch) {
        const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
        const newLines = normalizedNew.split('\n').map((line, j) => {
          if (j === 0) return originalIndent + line.trimStart();
          return line;
        });
        
        contentLines.splice(i, oldLines.length, ...newLines);
        modifiedContent = contentLines.join('\n');
        matchFound = true;
        break;
      }
    }
    
    if (!matchFound) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }
  
  const diff = createTwoFilesPatch(filePath, filePath, content, modifiedContent, 'original', 'modified');
  
  if (!dryRun) {
    await fs.writeFile(filePath, modifiedContent, 'utf-8');
  }
  
  return diff;
}

async function searchFiles(
  rootPath: string,
  pattern: string,
  excludePatterns: string[] = []
): Promise<string[]> {
  const results: string[] = [];
  
  async function searchDir(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Check exclude patterns
        if (excludePatterns.some(exclude => minimatch(fullPath, exclude))) {
          continue;
        }
        
        // Check if matches pattern
        if (minimatch(entry.name.toLowerCase(), `*${pattern.toLowerCase()}*`)) {
          results.push(fullPath);
        }
        
        // Recurse into directories
        if (entry.isDirectory()) {
          await searchDir(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  await searchDir(rootPath);
  return results;
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'Filesystem HTTP Server',
    version: '0.1.0',
    allowed_directories: allowedDirectories
  });
});

// List available tools
app.get('/tools', (req: Request, res: Response) => {
  const tools = [
    { name: 'read_file', description: 'Read complete contents of a file' },
    { name: 'read_multiple_files', description: 'Read multiple files simultaneously' },
    { name: 'write_file', description: 'Create new file or overwrite existing' },
    { name: 'edit_file', description: 'Make selective edits to a file' },
    { name: 'create_directory', description: 'Create new directory' },
    { name: 'list_directory', description: 'List directory contents' },
    { name: 'move_file', description: 'Move or rename files and directories' },
    { name: 'search_files', description: 'Recursively search for files/directories' },
    { name: 'get_file_info', description: 'Get detailed file/directory metadata' },
  ];
  res.json({ tools });
});

// MCP-compatible execute endpoint
app.post('/execute', async (req: Request, res: Response) => {
  try {
    const { tool, arguments: args } = req.body;
    
    if (!tool) {
      return res.status(400).json({ error: 'Missing tool parameter' });
    }

    console.log(`[Filesystem] Executing tool: ${tool}`);

    switch (tool) {
      case 'read_file': {
        if (!args.path) {
          return res.status(400).json({ error: 'Path is required for read_file' });
        }
        const validPath = await validatePath(args.path);
        const content = await fs.readFile(validPath, 'utf-8');
        return res.json({
          status: 'success',
          output: content
        });
      }

      case 'read_multiple_files': {
        if (!args.paths || !Array.isArray(args.paths)) {
          return res.status(400).json({ error: 'Paths array is required for read_multiple_files' });
        }
        const results = await Promise.all(
          args.paths.map(async (filePath: string) => {
            try {
              const validPath = await validatePath(filePath);
              const content = await fs.readFile(validPath, 'utf-8');
              return `${filePath}:\n${content}\n`;
            } catch (error: any) {
              return `${filePath}: Error - ${error.message}`;
            }
          })
        );
        return res.json({
          status: 'success',
          output: results.join('\n---\n')
        });
      }

      case 'write_file': {
        if (!args.path || args.content === undefined) {
          return res.status(400).json({ error: 'Path and content are required for write_file' });
        }
        const validPath = await validatePath(args.path);
        await fs.writeFile(validPath, args.content, 'utf-8');
        return res.json({
          status: 'success',
          output: `Successfully wrote to ${args.path}`
        });
      }

      case 'edit_file': {
        if (!args.path || !args.edits) {
          return res.status(400).json({ error: 'Path and edits are required for edit_file' });
        }
        const validPath = await validatePath(args.path);
        const dryRun = args.dryRun || false;
        const diff = await applyFileEdits(validPath, args.edits, dryRun);
        return res.json({
          status: 'success',
          output: diff,
          dryRun: dryRun
        });
      }

      case 'create_directory': {
        if (!args.path) {
          return res.status(400).json({ error: 'Path is required for create_directory' });
        }
        const validPath = await validatePath(args.path);
        await fs.mkdir(validPath, { recursive: true });
        return res.json({
          status: 'success',
          output: `Successfully created directory ${args.path}`
        });
      }

      case 'list_directory': {
        if (!args.path) {
          return res.status(400).json({ error: 'Path is required for list_directory' });
        }
        const validPath = await validatePath(args.path);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        const listing = entries.map(entry => {
          const prefix = entry.isDirectory() ? '[DIR]' : '[FILE]';
          return `${prefix} ${entry.name}`;
        }).join('\n');
        return res.json({
          status: 'success',
          output: listing
        });
      }

      case 'move_file': {
        if (!args.source || !args.destination) {
          return res.status(400).json({ error: 'Source and destination are required for move_file' });
        }
        const validSource = await validatePath(args.source);
        const validDest = await validatePath(args.destination);
        await fs.rename(validSource, validDest);
        return res.json({
          status: 'success',
          output: `Successfully moved ${args.source} to ${args.destination}`
        });
      }

      case 'search_files': {
        if (!args.path || !args.pattern) {
          return res.status(400).json({ error: 'Path and pattern are required for search_files' });
        }
        const validPath = await validatePath(args.path);
        const excludePatterns = args.excludePatterns || [];
        const results = await searchFiles(validPath, args.pattern, excludePatterns);
        return res.json({
          status: 'success',
          output: results.length > 0 ? results.join('\n') : 'No matches found'
        });
      }

      case 'get_file_info': {
        if (!args.path) {
          return res.status(400).json({ error: 'Path is required for get_file_info' });
        }
        const validPath = await validatePath(args.path);
        const stats = await fs.stat(validPath);
        return res.json({
          status: 'success',
          output: JSON.stringify({
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            accessed: stats.atime,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            permissions: stats.mode.toString(8).slice(-3),
          }, null, 2)
        });
      }

      default:
        return res.status(400).json({ 
          error: `Unknown tool: ${tool}`,
          available_tools: [
            'read_file', 'read_multiple_files', 'write_file', 'edit_file',
            'create_directory', 'list_directory', 'move_file', 'search_files', 'get_file_info'
          ]
        });
    }
  } catch (error: any) {
    console.error(`[Filesystem] Error executing tool: ${error.message}`);
    res.status(500).json({ 
      status: 'error',
      error: error.message 
    });
  }
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Filesystem HTTP Server listening on port ${port}`);
  console.log(`✅ Allowed directories: ${allowedDirectories.join(', ')}`);
});
