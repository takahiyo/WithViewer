// Fixed synthetic meeting only; never read stored meetings or print credentials.
const response = await fetch('http://127.0.0.1:5173/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '今の説明、どう思う？短く答えて。',
    context: JSON.stringify({ title: '合成した接続試験', recentMeetingEvidence: ['[会議 00:10–00:20 / synthetic] A案は100万円で2週間。B案は80万円で4週間。決定は次回。'] }), history: [] }),
  signal: AbortSignal.timeout(65000)
});
const result = await response.json();
if (!response.ok || !result.text?.trim()) { console.error('Text chat check failed: ' + (result.error || 'empty response')); process.exitCode = 1; }
else console.log('Text chat API: OK\n' + result.text);
