import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { UserManagementGateway } from './app/gateways/user-management-gateway';
import { LocationGateway } from './app/gateways/location-gateway';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.use(express.json());

const userGateway = new UserManagementGateway();
const locationGateway = new LocationGateway();

const angularApp = new AngularNodeAppEngine();

/**
 * API Route: Register/Onboard Claimant (User Management Gateway)
 */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, profile } = req.body;
  const result = await userGateway.handleRegistration(name, email, password, profile || {
    name,
    email,
    skills: '',
    experience: '',
    aspirations: '',
    workPrefs: ''
  });
  res.status(result.statusCode).json(result);
});

/**
 * API Route: Login Claimant (User Management Gateway Verification)
 */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await userGateway.handleLogin(email, password);
  res.status(result.statusCode).json(result);
});

/**
 * API Route: Get Claimant Profile (User Management Gateway)
 */
app.get('/api/auth/profile', async (req, res) => {
  const email = req.query['email'] as string;
  const result = await userGateway.handleGetProfile(email);
  res.status(result.statusCode).json(result);
});

/**
 * API Route: Update Claimant Profile (User Management Gateway)
 * Proxies the PUT request to the Java backend, forwarding the Authorization header if present.
 */
app.put('/api/auth/profile', async (req, res) => {
  const email = req.query['email'] as string;
  const token = req.headers['authorization'] as string;
  const result = await userGateway.handleUpdateProfile(email, req.body, token);
  res.status(result.statusCode).json(result);
});

/**
 * API Route: Search/Autocomplete UK Locations (Location Gateway)
 */
app.get('/api/locations', async (req, res) => {
  const query = req.query['q'] as string;
  if (query === undefined) {
    res.status(400).json({
      statusCode: 400,
      success: false,
      message: "Missing search query parameter. 'q' must be provided."
    });
    return;
  }
  const result = await locationGateway.handleSearch(query);
  res.status(result.statusCode).json(result);
});

/**
 * API Route: Get location by postcode (Location Gateway)
 */
app.get('/api/postcodes/:postcode', async (req, res) => {
  const postcode = req.params.postcode;
  if (!postcode) {
    res.status(400).json({
      statusCode: 400,
      success: false,
      message: "Missing postcode parameter."
    });
    return;
  }
  const result = await locationGateway.handlePostcode(postcode);
  res.status(result.statusCode).json(result);
});

/**
 * API Route: Semantic Match Job to User Profile
 */
// Semantic matching has been removed to simplify backend integration

// Tailoring has been removed to simplify backend integration

// Journal entry generation has been removed to simplify backend integration


/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 3000; // Binding to port 3000 as requested
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);