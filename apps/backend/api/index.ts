import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import helmet from 'helmet';
import express from 'express';
import type { Request, Response } from 'express';

// Prefer compiled/dist app module when available (reduces runtime transpile issues on Vercel)
let AppModule: any;
try {
  // when deployed, dist is included via vercel.json includeFiles
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AppModule = require('../dist/src/app.module').AppModule;
} catch (e) {
  // fallback to source module during local dev or if dist missing
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AppModule = require('../src/app.module').AppModule;
  }

const expressApp = express();
let isInitialized = false;

// Provide a lightweight root endpoint so requests to `/` don't return "Cannot GET /".
// This helps Vercel function root requests and gives a quick health/info response.
expressApp.get('/', (_req, res) => {
  res.json({
    message: 'API is running',
    docs: '/api-docs.html',
    health: '/api/v1/health',
  });
});

async function bootstrap() {
  if (!isInitialized) {
    const nestApp = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

    nestApp.use(helmet());
    nestApp.enableCors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    nestApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    nestApp.setGlobalPrefix('api/v1');
    await nestApp.init();
    isInitialized = true;
    console.log('Nest server initialized');
  }
  return undefined;
}

export default async (req: Request, res: Response) => {
  try {
    await bootstrap();
    // Invoke the underlying Express app directly. This avoids runtime
    // detection issues from @vendia/serverless-express on Vercel.
    return expressApp(req, res);
  } catch (err: any) {
    // Log full error so Vercel function logs capture it
    console.error('Function bootstrap error:', err && err.stack ? err.stack : err);
    try {
      res.status(500).send(`A server error has occurred\n\n${err?.message || String(err)}`);
    } catch (writeErr) {
      console.error('Failed to send response after error:', writeErr);
    }
    return undefined as any;
  }
};
