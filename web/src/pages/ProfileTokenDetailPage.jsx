import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import { ArrowLeft, ExternalLink, Hexagon } from 'lucide-react';
import { AmbientBg } from '../components/PageChrome.jsx';
import CopyTextButton from '../components/CopyTextButton.jsx';
import { useAuthApi } from '../useAuthApi.js';
import { formatLabTokenSupply } from '../formatLabTokenSupply.js';
import { findMetadataPda } from '../splTokenMetadataIx.js';

const CLUSTER = 'devnet';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

function SpecRow({ label, value, mono = true }) {
  return (
    <div className="grid gap-1 border-b border-(--border)/80 py-4 last:border-0 sm:grid-cols-[minmax(140px,32%)_1fr] sm:items-start sm:gap-6">
      <dt className="text-xs font-medium leading-snug text-(--text-tertiary)">{label}</dt>
      <dd
        className={`min-w-0 text-sm leading-relaxed text-(--text-primary) ${mono ? 'font-mono text-[13px] tracking-tight break-all' : ''}`}>
        
        {value}
      </dd>
    </div>);

}

function BackToProfileLink() {
  return (
    <Link
      to="/profile"
      className="mt-6 inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110"
      style={{ background: 'hsl(260 25% 11%)' }}>
      
      Back to profile
    </Link>);

}

export default function ProfileTokenDetailPage() {
  const { mint: mintParam } = useParams();
  const api = useAuthApi();
  const mint = mintParam ? decodeURIComponent(mintParam) : '';
  const mintOk = Boolean(mint && MINT_RE.test(mint));

  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(mintOk);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!mint) {
      setErr('Missing mint in the link.');
      setLoading(false);
      return;
    }
    if (!mintOk) {
      setErr('Invalid mint address in URL.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { tokens } = await api('/lab-tokens');
        if (cancelled) return;
        const list = Array.isArray(tokens) ? tokens : [];
        const found = list.find((t) => t.mint === mint) ?? null;
        setToken(found);
        if (!found) setErr('This token is not in your Triangle list (or was removed).');
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Could not load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, mint, mintOk]);

  let metadataPk = null;
  if (mintOk) {
    try {
      metadataPk = findMetadataPda(new PublicKey(mint)).toBase58();
    } catch {

    }
  }

  const solscanToken = mintOk ? `https://solscan.io/token/${mint}?cluster=${CLUSTER}` : '#';
  const explorerMint = mintOk ? `https://explorer.solana.com/address/${mint}?cluster=${CLUSTER}` : '#';

  return (
    <div className="min-h-dvh px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
      <AmbientBg />
      <div className="relative mx-auto max-w-3xl animate-fade-up">
        <Link
          to="/profile"
          className="inline-flex items-center gap-2 text-sm font-medium text-(--text-secondary) transition-colors hover:text-(--accent)">
          
          <ArrowLeft className="h-4 w-4 opacity-70" aria-hidden />
          Profile
        </Link>

        {!mint || !mintOk ?
        <div className="mt-10 rounded-2xl border border-(--border) bg-white/90 px-6 py-10 text-center shadow-sm">
            <p className="text-sm font-medium text-(--text-secondary)">{err || 'Bad link'}</p>
            <BackToProfileLink />
          </div> :
        loading ?
        <div className="mt-16 flex justify-center gap-1.5">
            {[0, 1, 2].map((i) =>
          <div
            key={i}
            className="h-2 w-2 rounded-full bg-(--accent-border) animate-pulse"
            style={{ animationDelay: `${i * 0.15}s` }} />

          )}
          </div> :
        !token ?
        <div className="mt-10 rounded-2xl border border-(--border) bg-white/90 px-6 py-10 text-center shadow-sm">
            <p className="text-sm font-medium text-(--text-secondary)">
              {err || 'Token not found'}
            </p>
            <BackToProfileLink />
          </div> :

        <>
            <header className="mt-8 sm:mt-10">
              <div className="flex flex-wrap items-start gap-4">
                {token.metadataImageUrl?.trim() ?
              <img
                src={token.metadataImageUrl.trim()}
                alt=""
                className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-md ring-1 ring-black/10" /> :


              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md">
                    <Hexagon className="h-8 w-8" strokeWidth={2} aria-hidden />
                  </span>
              }
                <div className="min-w-0">
                  <h1 className="text-balance text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-[1.75rem]">
                    {token.displayName || 'Token'}
                    {token.symbol ?
                  <span className="ml-2 font-normal text-(--accent)">· {token.symbol}</span> :
                  null}
                  </h1>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wider text-(--text-tertiary)">
                    {token.cluster || CLUSTER} · saved in your account
                  </p>
                </div>
              </div>
            </header>

            <div className="mt-10 overflow-hidden rounded-[24px] border border-(--border) bg-white/90 shadow-[var(--shadow-card)]">
              <div className="border-b border-(--border) px-6 py-4 sm:px-8">
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-(--text-tertiary)">
                  Mint & links
                </h2>
                <p className="mt-3 font-mono text-[13px] leading-relaxed tracking-tight text-(--text-primary) break-all">
                  {token.mint}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <CopyTextButton text={token.mint} label="Copy mint" />
                </div>
                <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <a
                  href={solscanToken}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-(--accent) hover:opacity-80">
                  
                    Solscan
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
                  </a>
                  <a
                  href={explorerMint}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-(--accent) hover:opacity-80">
                  
                    Solana Explorer
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
                  </a>
                  {token.signature ?
                <a
                  href={`https://explorer.solana.com/tx/${token.signature}?cluster=${CLUSTER}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-(--accent) hover:opacity-80">
                  
                      Creation tx
                      <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
                    </a> :
                null}
                </div>
              </div>

              <div className="px-6 py-6 sm:px-8 sm:py-8">
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-(--text-tertiary)">
                  Details
                </h2>
                <dl className="mt-2">
                  <SpecRow
                  label="Supply (formatted)"
                  value={formatLabTokenSupply(token.supplyRaw, token.decimals)} />
                
                  <SpecRow label="Decimals" value={String(token.decimals)} />
                  {token.ata ? <SpecRow label="Your ATA" value={token.ata} /> : null}
                  {metadataPk ? <SpecRow label="Metadata account" value={metadataPk} /> : null}
                  {token.metadataUri ?
                <SpecRow label="Metadata URI" value={token.metadataUri} /> :
                null}
                  {token.metadataPriceNote ?
                <SpecRow
                  label="Price / note"
                  value={token.metadataPriceNote}
                  mono={false} /> :

                null}
                  {token.pythFeedHex ?
                <SpecRow label="Pyth feed (oracle ref)" value={token.pythFeedHex} /> :
                null}
                  {token.createdAt ?
                <SpecRow
                  label="Saved in Triangle"
                  value={new Date(token.createdAt).toLocaleString()}
                  mono={false} /> :

                null}
                </dl>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
              <Link
              to="/deals/new"
              className="rounded-full border border-(--border) bg-white px-6 py-3 text-sm font-semibold text-(--text-primary) shadow-sm transition-colors hover:bg-slate-50">
              
                Token Lab — mint another
              </Link>
            </div>
          </>
        }
      </div>
    </div>);

}