export default function MissingPrivyConfig() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-lg shadow-slate-200/60">
        <h1 className="text-xl font-semibold text-slate-900">Privy App ID required</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Create an app in the{' '}
          <a className="font-medium text-violet-600 underline" href="https://dashboard.privy.io/" target="_blank" rel="noreferrer">
            Privy Dashboard
          </a>{' '}
          and copy the App ID into <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-800">web/.env</code>:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-800">
          VITE_PRIVY_APP_ID=clxxxxxxxxxxxxxxxx
        </pre>
        <p className="mt-4 text-sm text-slate-600">
          Restart <code className="rounded bg-slate-100 px-1">npm run dev</code> after saving.
        </p>
      </div>
    </div>
  )
}
