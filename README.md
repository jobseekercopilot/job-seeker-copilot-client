# Job Seeker Copilot Client

An Angular-based client application for the Job Seeker Copilot system, designed to help job seekers manage their job search process with AI-powered assistance.

## Features

- **Landing & Authentication**: User authentication and landing page
- **Claimant Profile**: Manage job seeker profiles and information
- **Location Services**: Location-based job search capabilities
- **User Management**: Comprehensive user account management
- **AI Integration**: Powered by Google Gemini AI for intelligent job matching and assistance
- **Responsive UI**: Built with Angular Material and Tailwind CSS for a modern, responsive experience

## Tech Stack

- **Framework**: Angular 21
- **UI Library**: Angular Material
- **Styling**: Tailwind CSS
- **AI**: Google Gemini AI
- **Server**: Express (SSR support)
- **Language**: TypeScript 5.9

## Prerequisites

- Node.js (v20 or higher recommended)
- npm or yarn
- Gemini API key (for AI features)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mcgeeverbernard1992/job-seeker-copilot-client.git
   cd job-seeker-copilot-client
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```
   
   Add your Gemini API key to `.env.local`:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

## Development

Run the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Build

Build the project for production:
```bash
npm run build
```

## Testing

Run the test suite:
```bash
npm test
```

## Linting

Run ESLint to check code quality:
```bash
npm run lint
```

## Project Structure

```
src/
├── app/
│   ├── features/
│   │   ├── landing-auth/       # Authentication feature
│   │   └── claimant-profile/   # User profile management
│   ├── gateways/               # API gateway services
│   └── services/               # Core services
├── assets/                     # Static assets
└── public/                     # Public files
```

## API Documentation

See the `api-read-me/` directory for detailed API documentation:
- [User Management Gateway](api-read-me/user-management-gateway.md)
- [Location Gateway](api-read-me/location-gateway.md)
- [Job Finder Gateway](api-read-me/job-finder-gateway.md)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is private and proprietary.

## Support

For issues and questions, please contact the development team.