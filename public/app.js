import { supabase } from './supabase.js';

// Top-level console log for debugging script loading
// console.log('app.js loaded');

// --- Config ---
const NOMINEES_PER_PAGE = 10;
// Remove the hardcoded COUNTDOWN_TARGET and replace with dynamic fetching
let COUNTDOWN_TARGET = null;
const PLACEHOLDER_PHOTO = 'https://via.placeholder.com/300x400/FFD700/000000?text=Photo';

// --- DOM Elements ---
const nomineesEl = document.getElementById('nominees');
const paginationEl = document.getElementById('pagination');
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const yearEl = document.getElementById('year');
const top5Btn = document.getElementById('top5Btn');
const top5TableSection = document.getElementById('top5TableSection');
const top5Table = document.getElementById('top5Table').querySelector('tbody');

// --- State ---
let nominees = [];
let filteredNominees = [];
let currentPage = 1;
let user = null;
let userVotes = new Set();
// Remove all FingerprintJS/Fingerprint2 logic
// Remove deviceFingerprint and loadFingerprint

// --- Utility ---
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));
}

// --- Countdown Timer ---
async function fetchCountdownDate() {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'countdown_date')
    .single();
  
  if (data && data.value) {
    COUNTDOWN_TARGET = new Date(data.value);
    updateCountdown();
  } else {
    // Fallback to default date if not set
    COUNTDOWN_TARGET = new Date('2024-12-31T23:59:59Z');
    updateCountdown();
  }
}

function updateCountdown() {
  if (!COUNTDOWN_TARGET) return;
  
  const now = new Date();
  const diff = COUNTDOWN_TARGET - now;
  
  if (diff <= 0) {
    document.getElementById('days').textContent = '00';
    document.getElementById('hours').textContent = '00';
    document.getElementById('minutes').textContent = '00';
    document.getElementById('seconds').textContent = '00';
    return;
  }
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  document.getElementById('days').textContent = days.toString().padStart(2, '0');
  document.getElementById('hours').textContent = hours.toString().padStart(2, '0');
  document.getElementById('minutes').textContent = minutes.toString().padStart(2, '0');
  document.getElementById('seconds').textContent = seconds.toString().padStart(2, '0');
}

yearEl.textContent = new Date().getFullYear();

// --- Auth ---
async function getUser() {
  const { data } = await supabase.auth.getUser();
  user = data.user;
  if (user) {
    // Get all votes by this user
    const { data: votes } = await supabase
      .from('votes')
      .select('nominee_id')
      .eq('user_id', user.id);
    userVotes = new Set((votes || []).map(v => v.nominee_id));
  } else {
    userVotes = new Set();
  }
}

async function signInWithGoogle(redirectTo = window.location.href) {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
}

// --- Data Fetching ---
async function fetchNominees() {
  // Fetch all nominees
  const { data: nomineesData, error: nomineesError } = await supabase
    .from('nominees')
    .select('*')
    .order('created_at', { ascending: true });

  // Fetch all votes
  const { data: votesData, error: votesError } = await supabase
    .from('votes')
    .select('nominee_id');

  if (nomineesData) {
    // Count votes for each nominee
    const voteCounts = {};
    (votesData || []).forEach(v => {
      voteCounts[v.nominee_id] = (voteCounts[v.nominee_id] || 0) + 1;
    });
    nomineesData.forEach(n => {
      n.votes = voteCounts[n.id] || 0;
    });
    nominees = nomineesData;
    filteredNominees = nominees;
  } else {
    nominees = [];
    filteredNominees = [];
  }
}

// --- Voting ---
// This will block voting from the same browser/device, regardless of user, unless localStorage is cleared.
async function voteForNominee(nomineeId) {
  if (localStorage.getItem('ashendaVoted')) {
    showVoteMessage('Already voted!');
    return;
  }
  if (!user) {
    await signInWithGoogle();
    return;
  }
  if (userVotes.size > 0) {
    showVoteMessage('Already voted!');
    return;
  }
  // Insert vote
  const { error: voteError } = await supabase
    .from('votes')
    .insert({ user_id: user.id, nominee_id: nomineeId });
  if (voteError) {
    showVoteMessage('Already voted!');
    return;
  }
  // Set device flag in localStorage
  localStorage.setItem('ashendaVoted', 'true');
  // Refresh user and nominees to get updated vote counts
  await getUser();
  await fetchNominees();
  renderNominees();
  showVoteMessage('Thank you for voting!');
}

// --- Render Functions ---
function showVoteMessage(msg) {
  const voteMessage = document.getElementById('voteMessage');
  if (voteMessage) {
    voteMessage.textContent = msg;
    voteMessage.style.display = 'block';
    setTimeout(() => {
      voteMessage.style.display = 'none';
    }, 2200);
  }
}

function renderNominees() {
  // Pagination
  const total = filteredNominees.length;
  const totalPages = Math.ceil(total / NOMINEES_PER_PAGE);
  currentPage = Math.max(1, Math.min(currentPage, totalPages));
  const start = (currentPage - 1) * NOMINEES_PER_PAGE;
  const pageNominees = filteredNominees.slice(start, start + NOMINEES_PER_PAGE);

  nomineesEl.innerHTML = pageNominees.map(n => {
    const hasVoted = userVotes.size > 0;
    const votedForThis = userVotes.has(n.id);
    // Ensure optional fields are handled safely
    const photo = n.photo_url ? escapeHTML(n.photo_url) : PLACEHOLDER_PHOTO;
    const name = n.name ? escapeHTML(n.name) : 'Unknown';
    const city = n.city ? escapeHTML(n.city) : '';
    const facebook = n.facebook_url ? escapeHTML(n.facebook_url) : '#';
    return `
      <div class="nominee-card">
        <img src="${photo}" alt="${name}">
        <div class="name">${name}</div>
        <div class="city">${city}</div>
        <a class="facebook" href="${facebook}" target="_blank">Facebook</a>
        <div class="votes">Votes: ${n.votes || 0}</div>
        <button class="vote-btn" data-id="${n.id}" ${hasVoted ? 'disabled' : ''}>
          ${votedForThis ? 'Voted' : 'Vote'}
        </button>
      </div>
    `;
  }).join('');

  // Pagination
  let pagBtns = '';
  if (totalPages > 1) {
    pagBtns += `<button ${currentPage === 1 ? 'disabled' : ''} data-page="prev">&lt;</button>`;
    for (let i = 1; i <= totalPages; i++) {
      pagBtns += `<button class="${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    pagBtns += `<button ${currentPage === totalPages ? 'disabled' : ''} data-page="next">&gt;</button>`;
  }
  paginationEl.innerHTML = pagBtns;
  renderTop5();
}

// --- Top 5 Popup ---
function renderTop5() {
  const top5 = [...nominees].sort((a, b) => b.votes - a.votes).slice(0, 5);
  const icons = ['🥇', '🥈', '🥉', '🏅', '🏅'];
  const top5List = document.getElementById('top5List');
  if (top5List) {
    top5List.innerHTML = top5.map((n, i) => `
      <div class="top5-card">
        <div class="top5-rank"><span class="icon">${icons[i]}</span> ${i + 1}</div>
        <img src="${escapeHTML(n.photo_url || PLACEHOLDER_PHOTO)}" alt="${escapeHTML(n.name)}">
        <div class="name">${escapeHTML(n.name)}</div>
        <div class="votes">Votes: ${n.votes || 0}</div>
      </div>
    `).join('');
  }
}

function renderTop5Table() {
  const top5 = [...nominees].sort((a, b) => b.votes - a.votes).slice(0, 5);
  const icons = ['🥇', '🥈', '🥉', '🏅', '🏅'];
  top5Table.innerHTML = top5.map((n, i) => `
    <tr>
      <td>${icons[i]} ${i + 1}</td>
      <td><img src="${escapeHTML(n.photo_url || PLACEHOLDER_PHOTO)}" alt="${escapeHTML(n.name)}"></td>
      <td>${escapeHTML(n.name)}</td>
      <td>${n.votes || 0}</td>
    </tr>
  `).join('');
}

// --- Event Listeners ---
nomineesEl.addEventListener('click', async e => {
  if (e.target.classList.contains('vote-btn')) {
    const nomineeId = e.target.getAttribute('data-id');
    if (localStorage.getItem('ashendaVoted')) {
      showVoteMessage('Already voted!');
      return;
    }
    await voteForNominee(nomineeId);
  }
});

paginationEl.addEventListener('click', e => {
  if (e.target.tagName === 'BUTTON') {
    const page = e.target.getAttribute('data-page');
    if (page === 'prev') currentPage--;
    else if (page === 'next') currentPage++;
    else currentPage = parseInt(page);
    renderNominees();
    window.scrollTo({ top: nomineesEl.offsetTop - 60, behavior: 'smooth' });
  }
});

searchForm.addEventListener('submit', e => {
  e.preventDefault();
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    filteredNominees = nominees;
  } else {
    filteredNominees = nominees.filter(n => n.name.toLowerCase().includes(q));
  }
  currentPage = 1;
  renderNominees();
});

top5Btn.addEventListener('click', () => {
  if (top5TableSection.style.display === 'none' || top5TableSection.style.display === '') {
    renderTop5Table();
    top5TableSection.style.display = 'block';
    top5Btn.textContent = 'Hide Top 5';
    // Scroll to Top 5 table section
    top5TableSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    top5TableSection.style.display = 'none';
    top5Btn.textContent = 'Top 5';
  }
});

// --- Initial Load ---
async function init() {
  await getUser();
  await fetchCountdownDate(); // Fetch countdown date first
  await fetchNominees();
  searchInput.value = '';
  filteredNominees = nominees;
  renderNominees();
  
  // Start countdown timer
  setInterval(updateCountdown, 1000);
}

init(); 