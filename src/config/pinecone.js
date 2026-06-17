// import {pinecone} from "@pinecone-database/pinecone";

// const client = new pinecone.PineconeClient();
// await client.init({
//   apiKey: process.env.PINECONE_API_KEY,
//   environment: "us-east1-gcp"
// });

// export const getPineconeIndex = async () => {
//   const index = client.Index(process.env.PINECONE_INDEX_NAME);
//   return index;
// }

import { Pinecone } from "@pinecone-database/pinecone";

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

export const pineconeIndex =
  pinecone.index(process.env.PINECONE_INDEX_NAME);