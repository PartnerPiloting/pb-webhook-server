export default function Home() {
  return (
    <div style={{ padding: '50px', textAlign: 'center' }}>
      <h1>Vercel Deployment Test</h1>
      <p>If you can see this, the deployment worked! 🎉</p>
      <p>Timestamp: {new Date().toISOString()}</p>
    </div>
  );
}
