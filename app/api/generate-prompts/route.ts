import { NextRequest, NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { findSimilarPrompts } from '@/lib/mongodb';
import { selectTop3PromptsForOffering } from '@/lib/gemini-helpers';

export async function POST(request: NextRequest) {
  try {
    const { investigation_data, custom_prompt_template } = await request.json();

    if (!investigation_data) {
      return NextResponse.json({ error: 'Investigation data is required' }, { status: 400 });
    }

    const keywords = investigation_data.keywords || [];
    const persona = investigation_data.persona || 'General audience';
    const businessType = investigation_data.business_type || 'Unknown';

    if (keywords.length === 0) {
      return NextResponse.json({ error: 'Keywords are required' }, { status: 400 });
    }

    console.log(`Processing ${keywords.length} keywords to find relevant prompts in parallel`);

    // Process all keywords in parallel
    const offeringsWithPrompts = await Promise.all(
      keywords.map(async (keywordData: any) => {
        try {
          const keyword = keywordData.keyword || '';

          console.log(`Processing keyword: ${keyword}`);

          // Generate embedding from keyword
          const embedding = await generateEmbedding(keyword);

          if (!embedding) {
            console.warn(`Could not generate embedding for keyword ${keyword}`);
            return {
              offering: keywordData,
              candidate_prompts: [],
              selected_prompts: [],
              prompt_sent: '',
            };
          }

          // Find top 100 similar prompts
          const similarPrompts = await findSimilarPrompts(embedding, 100);

          if (!similarPrompts || similarPrompts.length === 0) {
            console.warn(`No similar prompts found for keyword ${keyword}`);
            return {
              offering: keywordData,
              candidate_prompts: [],
              selected_prompts: [],
              prompt_sent: '',
            };
          }

          // Select top 3 prompts using Gemini with marketer context
          // Use keyword as both label and description since it's a keyword
          const geminiResult = await selectTop3PromptsForOffering(
            keyword,
            keyword,
            similarPrompts,
            persona,
            businessType,
            custom_prompt_template
          );

          const selectedPrompts = geminiResult.selected_prompts;
          const promptSent = geminiResult.prompt_sent;

          console.log(`Found ${selectedPrompts.length} selected prompts for keyword: ${keyword}`);
          console.log(`Candidate prompts count: ${similarPrompts.slice(0, 100).length}`);

          return {
            offering: keywordData,
            candidate_prompts: similarPrompts.slice(0, 100), // Top 100 candidate prompts sent to Gemini
            selected_prompts: selectedPrompts, // Top 3 selected by Gemini (or fewer)
            prompt_sent: promptSent, // Actual prompt sent to Gemini
          };
        } catch (error: any) {
          console.error(`Error processing keyword ${keywordData.keyword || 'unknown'}:`, error);
          return {
            offering: keywordData,
            candidate_prompts: [],
            selected_prompts: [],
            prompt_sent: '',
          };
        }
      })
    );

    return NextResponse.json({
      offerings_with_prompts: offeringsWithPrompts,
    });
  } catch (error: any) {
    console.error('Error generating prompts:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate prompts' }, { status: 500 });
  }
}

