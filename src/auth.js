import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserSessionPersistence, setPersistence, signInWithPopup, signOut } from 'firebase/auth';
import { authHeaders, setTokenProvider } from './api.js';

const messages = {
  'auth/popup-blocked': 'ポップアップがブロックされています。このサイトのポップアップを許可してください。',
  'auth/popup-closed-by-user': 'ログインを中止しました。',
  'auth/unauthorized-domain': 'この公開URLがFirebaseの承認済みドメインに登録されていません。',
  'auth/operation-not-allowed': 'FirebaseでGoogleログインを有効にしてください。',
  'auth/invalid-api-key': 'FirebaseのWebアプリ設定を確認してください。',
  'auth/network-request-failed': 'Googleログインに接続できません。ネットワークを確認してください。'
};
export async function prepareGoogleLogin(config, { loginButton, logoutButton, status, beforeLogout }) {
  const auth = getAuth(initializeApp(config));
  await setPersistence(auth, browserSessionPersistence);
  await auth.authStateReady();
  setTokenProvider(() => auth.currentUser?.getIdToken());
  logoutButton.hidden = !auth.currentUser;
  logoutButton.onclick = async () => {
    logoutButton.disabled = true;
    try { await beforeLogout(); await signOut(auth); location.reload(); }
    catch { status.textContent = 'ログアウトできませんでした。もう一度試してください。'; logoutButton.disabled = false; }
  };
  loginButton.onclick = async () => {
    loginButton.disabled = true; status.textContent = 'Googleログインを開いています…';
    try {
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider); location.reload();
    } catch (error) { status.textContent = messages[error.code] || 'Googleログインに失敗しました。設定とネットワークを確認してください。'; }
    finally { loginButton.disabled = false; }
  };
  if (!auth.currentUser) { status.textContent = 'Googleアカウントでログインしてください。'; return false; }
  const response = await fetch('/api/session', { headers: await authHeaders() });
  const session = await response.json();
  if (!response.ok) { status.textContent = session.error || 'このGoogleアカウントは利用できません。'; return false; }
  return session;
}
