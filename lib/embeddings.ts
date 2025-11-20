export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const huggingfaceApiKey = process.env.HUGGINGFACE_API_KEY;
    if (!huggingfaceApiKey) {
      throw new Error('HUGGINGFACE_API_KEY is not configured');
    }

    const EMBEDDINGS_URL = 'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction';
    const EMBEDDINGS_BACKUP_URL = 'https://n1ngft8l1c53nho4.us-east-1.aws.endpoints.huggingface.cloud';

    const headers = {
      'Authorization': `Bearer ${huggingfaceApiKey}`,
      'Content-Type': 'application/json',
    };
    const payload = { inputs: [text] };

    console.log('Initiating embedding generation');

    let response;
    // Try primary URL with 10-second timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      response = await fetch(EMBEDDINGS_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log('Finished primary embeddings call');

      // Check status code
      if (response.status !== 200) {
        // Try with backup URL if primary URL fails
        console.warn(`Primary embedding URL failed with status ${response.status}. Trying backup URL.`);

        response = await fetch(EMBEDDINGS_BACKUP_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
      }
    } catch (error: any) {
      // Primary URL timed out or had an error, try backup URL
      console.warn(`Primary embedding URL error: ${error.message}. Trying backup URL.`);

      response = await fetch(EMBEDDINGS_BACKUP_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      // If backup also fails
      if (response.status !== 200) {
        // Check specifically for 503 error which indicates cold start
        if (response.status === 503) {
          const errorMsg = 'Embedding service is starting up and will be available in a few minutes. Please try again shortly.';
          console.error(`Embedding API returned 503. Response: ${await response.text()}`);
          throw new Error(errorMsg);
        } else {
          const errorMsg = `Embedding API returned non-200 status code: ${response.status}`;
          console.error(`${errorMsg}. Response: ${await response.text()}`);
          throw new Error(errorMsg);
        }
      }
    }

    if (response.status === 200) {
      try {
        const embeddingJson = await response.json();
        console.log('Embeddings complete');

        if (!embeddingJson || !Array.isArray(embeddingJson) || embeddingJson.length === 0) {
          const errorMsg = `Invalid embedding format returned: ${JSON.stringify(embeddingJson)}`;
          console.error(errorMsg);
          throw new Error(errorMsg);
        }

        // Return the first embedding vector
        return embeddingJson[0];
      } catch (error: any) {
        const errorMsg = `Failed to parse embedding response: ${error.message}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    } else {
      console.error(`Embedding API returned status ${response.status}`);
      return null;
    }
  } catch (error: any) {
    console.error('Error generating embedding:', error.message || error);
    return null;
  }
}

