import { supabase } from './supabase.js';



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

// --- Auth State Listener ---
supabase.auth.onAuthStateChange(async (event, session) => {
  try {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      user = session?.user || null;
      await getUser(); // Refresh user votes data
      renderNominees(); // Update UI
    } else if (event === 'SIGNED_OUT') {
      user = null;
      userVotes = new Set();
      renderNominees();
    }
  } catch (error) {
  }
});

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
    .limit(1)
    .single();
  
  if (data && data.value) {
    COUNTDOWN_TARGET = new Date(data.value);
    updateCountdown();
  } else {
    // Fallback to default date if not set
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 3);
    futureDate.setHours(23, 59, 59, 999);
    COUNTDOWN_TARGET = futureDate;
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
  try {
    console.log('🔐 Getting user data...');
    const { data } = await supabase.auth.getUser();
    user = data.user;
    
    if (user) {
      console.log('✅ User found:', user.id);
      // Keep track of user votes for display purposes only
      try {
        const { data: votes } = await supabase
          .from('votes')
          .select('nominee_id')
          .eq('user_id', user.id);
        userVotes = new Set((votes || []).map(v => v.nominee_id));
        console.log('✅ User votes loaded:', userVotes.size);
      } catch (voteError) {
        console.log('❌ Failed to load user votes:', voteError.message);
        userVotes = new Set();
      }
    } else {
      console.log('❌ No user found');
      userVotes = new Set();
    }
  } catch (error) {
    console.log('❌ getUser error:', error.message);
    user = null;
    userVotes = new Set();
  }
}

// Check if user is already signed in with Google (silent auth)
async function checkExistingGoogleAuth() {
  try {
    // First check if we already have a session
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session && sessionData.session.user) {
      user = sessionData.session.user;
      return true;
    }
    
    return false;
  } catch (err) {
    return false;
  }
}

async function signInWithGoogle(redirectTo = null) {
  try {
    // Determine the correct redirect URL based on environment
    let redirectUrl;
    if (redirectTo) {
      redirectUrl = redirectTo;
    } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      // Local development
      redirectUrl = window.location.origin + '/public/index.html';
    } else {
      // Production (Vercel)
      redirectUrl = 'https://ashendatigray.vercel.app/';
    }
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { 
        redirectTo: redirectUrl,
        queryParams: {
          prompt: 'select_account' // Force account selection
        }
      }
    });
    
    if (error) {
      showVoteMessage('Sign in failed. Please try again.');
    } else {
    }
  } catch (err) {
    showVoteMessage('Sign in failed. Please try again.');
  }
}

// --- Data Fetching ---
async function checkDatabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('nominees')
      .select('id')
      .limit(1);
    
    if (error) {
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

async function fetchNominees() {
  console.log('🔍 Starting fetchNominees...');
  
  try {
    // Fetch all nominees with proper RLS handling
    console.log('📊 Fetching nominees from database...');
    const { data: nomineesData, error: nomineesError } = await supabase
      .from('nominees')
      .select('*');

    if (nomineesError) {
      console.log('❌ Nominees fetch error:', nomineesError);
      nominees = [];
      filteredNominees = [];
      return;
    }

    console.log(`📋 Raw nominees data:`, nomineesData);

    // Fetch all votes (don't fail if votes fail)
    let votesData = [];
    try {
      console.log('🗳️ Fetching votes from database...');
      const { data: votesResult, error: votesError } = await supabase
        .from('votes')
        .select('nominee_id');
      if (!votesError) {
        votesData = votesResult || [];
        console.log(`📊 Votes data:`, votesData);
      } else {
        console.log('❌ Votes fetch error:', votesError);
      }
    } catch (error) {
      console.log('❌ Votes fetch failed:', error.message);
    }

    if (nomineesData && nomineesData.length > 0) {
      console.log(`✅ Processing ${nomineesData.length} nominees...`);
      // Count votes for each nominee
      const voteCounts = {};
      votesData.forEach(v => {
        voteCounts[v.nominee_id] = (voteCounts[v.nominee_id] || 0) + 1;
      });
      nomineesData.forEach(n => {
        n.votes = voteCounts[n.id] || 0;
      });
      nominees = nomineesData;
      filteredNominees = nominees;
      console.log(`🎉 Final nominees array:`, nominees);
    } else {
      console.log('❌ No nominees data or empty array');
      nominees = [];
      filteredNominees = [];
    }
  } catch (error) {
    console.log('💥 Fetch nominees error:', error);
    nominees = [];
    filteredNominees = [];
  }
}

// --- Voting ---
async function voteForNominee(nomineeId) {
  try {
    // If not logged in, try silent auth first, then popup if needed
    if (!user) {
      // Try to get existing session first
      const hasSession = await checkExistingGoogleAuth();
      if (hasSession) {
        await getUser();
      }
      
      // If still no user after silent check, show popup
      if (!user) {
        await signInWithGoogle();
        return; // Don't auto-vote, user needs to click again
      }
    }
    
    // Refresh user data to make sure we have latest vote information
    await getUser();
    
    // Check if user has already voted (database check - primary protection)
    if (userVotes.size > 0) {
      showVoteMessage('You already voted!');
      return;
    }
    
    // Check device-based voting as secondary protection
    const deviceVoteKey = `ashenda_voted_${user.id}`;
    try {
      if (localStorage.getItem(deviceVoteKey)) {
        showVoteMessage('You already voted!');
        return;
      }
    } catch (error) {
      // localStorage might be disabled or full, continue without device check
    }
    
    // Insert vote
    const { data: voteData, error: voteError } = await supabase
      .from('votes')
      .insert({ user_id: user.id, nominee_id: nomineeId })
      .select();
      
    if (voteError) {
      if (voteError.code === '23505') {
        showVoteMessage('You already voted!');
      } else {
        showVoteMessage('Error voting. Please try again.');
      }
      return;
    }
    
    // Set device flag for this user
    try {
      localStorage.setItem(deviceVoteKey, 'true');
    } catch (error) {
      // localStorage might be disabled or full, continue without setting flag
    }
    
    // Update vote count immediately
    const nominee = nominees.find(n => n.id === nomineeId);
    if (nominee) {
      nominee.votes = (nominee.votes || 0) + 1;
    }
    
    // Add to user votes
    userVotes.add(nomineeId);
    
    // Re-render immediately
    renderNominees();
    
    // Refresh from database
    setTimeout(async () => {
      try {
        await fetchNominees();
        renderNominees();
      } catch (error) {
      }
    }, 1000);
    
    showVoteMessage('Thank you for voting!');
  } catch (error) {
    showVoteMessage('Error voting. Please try again.');
  }
}

// --- Handle pending vote after OAuth redirect ---
async function handlePendingVote() {
  try {
    // Remove any pending vote without executing it
    sessionStorage.removeItem('pendingVote');
  } catch (error) {
  }
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
  console.log('🎨 Starting renderNominees...');
  console.log(`📊 filteredNominees length: ${filteredNominees.length}`);
  console.log(`📊 nominees length: ${nominees.length}`);
  
  // Pagination
  const total = filteredNominees.length;
  const totalPages = Math.ceil(total / NOMINEES_PER_PAGE);
  currentPage = Math.max(1, Math.min(currentPage, totalPages));
  const start = (currentPage - 1) * NOMINEES_PER_PAGE;
  const pageNominees = filteredNominees.slice(start, start + NOMINEES_PER_PAGE);
  
  console.log(`📄 Rendering page ${currentPage} of ${totalPages}`);
  console.log(`📄 Page nominees:`, pageNominees);

  nomineesEl.innerHTML = pageNominees.map(n => {
    // Check if user has already voted (any nominee)
    const userHasVoted = user && userVotes.size > 0;
    
    // Check device-based voting as backup (only if user exists and has valid ID)
    let deviceVoted = false;
    if (user && user.id && typeof user.id === 'string' && user.id.length > 0) {
      try {
        const deviceVoteKey = `ashenda_voted_${user.id}`;
        deviceVoted = !!localStorage.getItem(deviceVoteKey);
      } catch (error) {
        deviceVoted = false;
      }
    }
    
    // Determine button state
    let buttonText = 'Vote';
    let buttonDisabled = false;
    
    if (userHasVoted || deviceVoted) {
      buttonText = 'Voted';
      buttonDisabled = true;
    } else if (!user) {
      buttonText = 'Vote';
      buttonDisabled = false;
    }
    
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
        <button class="vote-btn" data-id="${n.id}" ${buttonDisabled ? 'disabled' : ''}>
          ${buttonText}
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

// Clear device votes function
function clearDeviceVotes() {
  if (user) {
    localStorage.removeItem(`ashenda_voted_${user.id}`);
    renderNominees();
  }
}

// Make it available globally
window.clearDeviceVotes = clearDeviceVotes;

// --- Initial Load ---
async function init() {
  console.log('🚀 Starting app initialization...');
  
  try {
    // Handle OAuth callback if returning from sign-in
    console.log('📋 Checking for OAuth callback...');
    const urlParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = urlParams.get('access_token');
    const refreshToken = urlParams.get('refresh_token');
    
    if (accessToken && refreshToken) {
      console.log('🔄 OAuth callback detected, setting session...');
      try {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        if (error) {
          console.log('❌ Failed to set session:', error.message);
        } else {
          console.log('✅ Session set successfully');
          // Clear the URL hash
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (sessionError) {
        console.log('❌ Session error:', sessionError.message);
      }
    }
    
    // Check if we're returning from OAuth or have existing session
    console.log('📋 Checking auth session...');
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user) {
      user = session.user;
      console.log('✅ User session found:', user.id);
    } else {
      console.log('❌ No user session found');
    }
    
    // Try to get user data (don't fail if it doesn't work)
    console.log('👤 Fetching user data...');
    try {
      // Add timeout to prevent getting stuck
      const userPromise = getUser();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('User fetch timeout')), 5000)
      );
      await Promise.race([userPromise, timeoutPromise]);
      console.log('✅ User data fetched successfully');
    } catch (error) {
      console.log('❌ User data fetch failed:', error.message);
    }
    
    // Try to fetch countdown date (don't fail if it doesn't work)
    console.log('⏰ Fetching countdown date...');
    try {
      await fetchCountdownDate();
      console.log('✅ Countdown date fetched successfully');
    } catch (error) {
      console.log('❌ Countdown fetch failed:', error.message);
    }
    
    // Try to fetch nominees (don't fail if it doesn't work)
    console.log('👥 Fetching nominees...');
    try {
      await fetchNominees();
      console.log(`✅ Nominees fetched successfully: ${nominees.length} nominees`);
    } catch (error) {
      console.log('❌ Nominees fetch failed:', error.message);
      nominees = [];
      filteredNominees = [];
    }
    
    console.log('🎨 Rendering nominees...');
    searchInput.value = '';
    filteredNominees = nominees;
    renderNominees();
    console.log('✅ App initialization complete');
    
    // Start countdown timer
    setInterval(updateCountdown, 1000);
    
    // Retry fetching nominees after 3 seconds if it failed
    setTimeout(async () => {
      if (nominees.length === 0) {
        console.log('🔄 Retrying nominees fetch...');
        try {
          await fetchNominees();
          filteredNominees = nominees;
          renderNominees();
          console.log(`✅ Retry successful: ${nominees.length} nominees`);
        } catch (error) {
          console.log('❌ Retry fetch failed:', error.message);
        }
      }
    }, 3000);
    
  } catch (error) {
    console.error('💥 Init error:', error);
    // Don't show error message, just continue with empty state
    nominees = [];
    filteredNominees = [];
    renderNominees();
  }
}

init(); 