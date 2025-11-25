# AI Traffic Eval Tool

A standalone evaluation tool for the AI traffic feature functionality. This tool allows you to test the website investigation and prompt generation features without user authentication or identification.

## Features

- **Website Investigation**: Uses Perplexity AI to analyze a website and identify:
  - Main offering (with 5 different phrasings)
  - Target audience persona
  - Business type (B2B/B2C/B2B + B2C)
  - Top 10 pages

- **Website Analysis**: Analyze websites and extract keywords for evaluation

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file with the following environment variables:
```
PERPLEXITY_API_KEY=your_perplexity_api_key_here
GOOGLE_API_KEY=your_google_api_key_here
HUGGINGFACE_API_KEY=your_huggingface_api_key_here
MONGODB_URI_temp_wc=your_mongodb_wc_cluster_connection_string_here
MONGODB_URI_temp_lm=your_mongodb_lm_cluster_connection_string_here
```

**Note**: The backend uses two separate MongoDB clusters:
- `MONGODB_URI_temp_wc`: Connection string for the WC cluster (contains `wc_included_conversations_collection` and `wc_4_8M_included_conversations_collection`)
- `MONGODB_URI_temp_lm`: Connection string for the LM cluster (contains `lm_included_conversations_collection`)

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a website URL in the input field
2. Click "Investigate" to analyze the website
3. Review the investigation results (keywords, persona, pages)

## Project Structure

```
Eval tool/
├── app/
│   ├── api/
│   │   ├── investigate/
│   │   │   └── route.ts          # API route for website investigation
│   │   ├── bronze-filtering-stage1/
│   │   │   └── route.ts          # API route for bronze filtering stage 1
│   │   └── bronze-filtering-stage2/
│   │       └── route.ts          # API route for bronze filtering stage 2
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Main page component
│   └── globals.css                # Global styles
├── lib/
│   ├── perplexity.ts              # Perplexity AI client
│   ├── gemini.ts                  # Gemini AI client
│   ├── gemini-helpers.ts          # Gemini helper functions
│   ├── embeddings.ts              # HuggingFace embedding generation
│   ├── mongodb.ts                 # MongoDB connection and vector search
│   └── openai.ts                  # OpenAI client
└── package.json
```

## Technologies

- **Next.js 14**: React framework with App Router
- **TypeScript**: Type safety
- **Tailwind CSS**: Styling
- **Perplexity AI**: Website investigation
- **Google Gemini**: Prompt selection
- **HuggingFace**: Embedding generation
- **MongoDB**: Vector search for similar prompts

