import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY } from
'@solana/web3.js';
import { getCreateMetadataAccountV3InstructionDataSerializer } from '@metaplex-foundation/mpl-token-metadata';
import { none } from '@metaplex-foundation/umi';

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);


export const METADATA_URI_MAX_BYTES = 200;

export function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}

function truncateUtf8(str, maxBytes) {
  let s = str;
  while (s.length > 0 && utf8ByteLength(s) > maxBytes) {
    s = s.slice(0, -1);
  }
  return s;
}

const INLINE_JSON_PREFIX = 'data:application/json,';


export function buildMetaplexMetadataUri(p) {
  const name = (p.name || 'Token').trim().slice(0, 32);
  const symbol = (p.symbol || '?').trim().toUpperCase().slice(0, 10);

  const external = p.metadataJsonUrl?.trim();
  if (external) {
    if (!/^https:\/\//i.test(external)) {
      return { error: 'Metadata JSON URL must start with https://' };
    }
    if (utf8ByteLength(external) > METADATA_URI_MAX_BYTES) {
      return {
        error: `Metadata JSON URL must be at most ${METADATA_URI_MAX_BYTES} bytes (Metaplex limit). Use a short link.`
      };
    }
    return { uri: external };
  }

  const doc = { name, symbol };
  const img = p.imageUrl?.trim();
  if (img) {
    if (!/^https:\/\//i.test(img)) {
      return { error: 'Logo URL must start with https://' };
    }
    doc.image = img;
  }
  const note = p.priceNote?.trim();
  if (note) {
    doc.description = `Reference price (not on-chain / not a market): ${note}`.slice(0, 160);
  }

  const uri = INLINE_JSON_PREFIX + JSON.stringify(doc);
  if (utf8ByteLength(uri) > METADATA_URI_MAX_BYTES) {
    return {
      error:
      `Logo + price text are too long for the on-chain URI (${METADATA_URI_MAX_BYTES} bytes max). ` +
      'Use a shorter https image link, shorten the price line, or paste a hosted Metadata JSON URL.'
    };
  }
  return { uri };
}


export function findMetadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}


export function createMetadataAccountV3Ix(mint, mintAuthority, payer, meta) {
  const metadata = findMetadataPda(mint);
  const name = (meta.name || 'Token').trim().slice(0, 32);
  const symbol = (meta.symbol || '?').trim().toUpperCase().slice(0, 10);
  const uri = truncateUtf8((meta.uri || '').trim(), METADATA_URI_MAX_BYTES);

  const serializer = getCreateMetadataAccountV3InstructionDataSerializer();
  const data = serializer.serialize({
    data: {
      name,
      symbol,
      uri,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null
    },
    isMutable: true,
    collectionDetails: none()
  });

  const updateAuthority = mintAuthority;

  return new TransactionInstruction({
    keys: [
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: mintAuthority, isSigner: true, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: updateAuthority, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }],

    programId: TOKEN_METADATA_PROGRAM_ID,
    data: Buffer.from(data)
  });
}