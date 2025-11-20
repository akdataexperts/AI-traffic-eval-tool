import { getGeminiClient } from './gemini';

interface PromptWithReasoning {
  prompt: string;
  reasoning: string;
}

export async function selectTop3PromptsForOffering(
  offeringLabel: string,
  offeringDescription: string,
  candidatePrompts: string[],
  persona: string,
  businessType: string,
  customPromptTemplate?: string
): Promise<{ selected_prompts: PromptWithReasoning[]; prompt_sent: string }> {
  try {
    if (!candidatePrompts || candidatePrompts.length === 0) {
      return { selected_prompts: [], prompt_sent: '' };
    }

    // If we have fewer than 3 prompts, return all of them with default reasoning
    if (candidatePrompts.length < 3) {
      return {
        selected_prompts: candidatePrompts.map((p) => ({
          prompt: p,
          reasoning: 'High relevance to offering',
        })),
        prompt_sent: 'Not enough candidate prompts to send to Gemini (fewer than 3)',
      };
    }

    const client = getGeminiClient();
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    // Limit to first 100 prompts
    const promptsList = candidatePrompts
      .slice(0, 100)
      .map((p, i) => `${i + 1}. ${p}`)
      .join('\n');

    // Use custom prompt template if provided, otherwise use default
    let prompt: string;
    if (customPromptTemplate) {
      prompt = customPromptTemplate
        .replace('[OFFERING_LABEL]', offeringLabel)
        .replace('[OFFERING_DESCRIPTION]', offeringDescription)
        .replace('[PERSONA]', persona)
        .replace('[BUSINESS_TYPE]', businessType)
        .replace('[CANDIDATE_PROMPTS]', promptsList);
    } else {
      // Default prompt
      prompt = `You are a marketing strategist analyzing search intent and user behavior.

Website Context:
- Offering: ${offeringLabel} - ${offeringDescription}
- Target Audience: ${persona}
- Business Type: ${businessType}

Your task: Select ONLY the TOP 3 most relevant user questions from the list below that someone would ask ChatGPT when they need this offering.

CRITICAL REQUIREMENTS:
- ONLY select questions that are HIGHLY RELEVANT and closely match this specific offering
- Questions must indicate genuine purchase/engagement intent for THIS EXACT offering
- Questions must align with what the target audience would actually ask
- If there are NOT 3 questions that meet these high standards, return FEWER questions (1-2 or even 0)
- DO NOT force selections just to reach 3 - quality over quantity
- DO NOT select duplicate or very similar questions - each selected question must be distinct and unique

Think like a marketer:
- Which questions indicate genuine purchase/engagement intent for this offering?
- Which questions align with what the target audience would actually ask?
- Which questions represent contemporary search behavior on AI platforms?
- Prioritize questions that would naturally lead users to this offering

User questions to evaluate:

${promptsList}

For each of your selections (1-3, or fewer if needed), provide:
1. The question number
2. A brief marketing-focused explanation (15-25 words) of why this question is valuable for reaching the target audience

Format your response exactly as:
[number]. [reasoning]

If you cannot find ANY questions that meet the high relevance standard, respond with:
NONE. No questions in the list are sufficiently relevant to this specific offering.

Example:
7. Shows clear purchase intent from decision-makers evaluating solutions, aligns perfectly with B2B audience seeking implementation guidance.
12. Represents common pain point question that leads naturally to our offering, high conversion potential.`;
    }

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    if (!text) {
      console.error('Gemini returned empty response for prompt selection');
      return {
        selected_prompts: candidatePrompts.slice(0, 3).map((p) => ({
          prompt: p,
          reasoning: 'Selected by relevance',
        })),
        prompt_sent: prompt,
      };
    }

    const selection = text.trim();
    console.log(`Gemini selection response: ${selection}`);

    // Check if Gemini found no relevant prompts
    if (selection.toUpperCase().startsWith('NONE')) {
      console.warn(`Gemini found no relevant prompts for offering: ${offeringLabel}`);
      return {
        selected_prompts: [],
        prompt_sent: prompt,
      };
    }

    // Parse the response to extract prompt numbers and reasoning
    const selectedPromptsWithReasoning: PromptWithReasoning[] = [];
    const lines = selection.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }

      // Try to extract number and reasoning
      // Format: "7. Shows clear purchase intent..."
      const match = trimmedLine.match(/^(\d+)\.\s*(.+)$/);
      if (match) {
        const number = parseInt(match[1], 10);
        const reasoning = match[2].trim();

        const index = number - 1;
        if (index >= 0 && index < candidatePrompts.length) {
          selectedPromptsWithReasoning.push({
            prompt: candidatePrompts[index],
            reasoning,
          });
        }
      }
    }

    console.log(
      `Gemini selected ${selectedPromptsWithReasoning.length} high-quality prompts for offering: ${offeringLabel}`
    );
    return {
      selected_prompts: selectedPromptsWithReasoning,
      prompt_sent: prompt,
    };
  } catch (error) {
    console.error('Error selecting top prompts with Gemini:', error);
    return {
      selected_prompts: candidatePrompts.slice(0, 3).map((p) => ({
        prompt: p,
        reasoning: 'Selected by relevance',
      })),
      prompt_sent: 'Error occurred during Gemini call',
    };
  }
}

