import { supabase } from './supabase.js';



// --- Config ---
const NOMINEES_PER_PAGE = 20; // More nominees per page = faster
let COUNTDOWN_TARGET = null;
const PLACEHOLDER_PHOTO = 'https://via.placeholder.com/300x400/FFD700/000000?text=Photo';
const DEBOUNCE_DELAY = 100; // Super fast search
const CACHE_DURATION = 30000; // 30 seconds cache

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
let lastFetchTime = 0; // Cache timestamp
let searchCache = new Map(); // Search results cache


// --- Auth State Listener ---
supabase.auth.onAuthStateChange(async (event, session) => {
  try {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      user = session?.user || null;
      // Don't refresh user data here to avoid blocking
      renderNominees(); // Update UI
    } else if (event === 'SIGNED_OUT') {
      user = null;
      userVotes = new Set();
      renderNominees();
    }
  } catch (error) {
    // Ignore auth errors, don't block the app
  }
});

// --- Utility ---
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));
}

// --- Countdown Timer ---
async function fetchCountdownDate() {
  try {
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
  } catch (error) {
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
    const { data } = await supabase.auth.getUser();
    user = data.user;
    
    if (user) {
      // Keep track of user votes for display purposes only
      try {
        const { data: votes } = await supabase
          .from('votes')
          .select('nominee_id')
          .eq('user_id', user.id);
        userVotes = new Set((votes || []).map(v => v.nominee_id));
      } catch (voteError) {
        userVotes = new Set();
      }
    } else {
      userVotes = new Set();
    }
  } catch (error) {
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
  // Check cache first
  const now = Date.now();
  if (now - lastFetchTime < CACHE_DURATION && nominees.length > 0) {
    return; // Use cached data
  }
  
  try {
    // Always try anonymous access first (no auth required for viewing)
    const { data: nomineesData, error: nomineesError } = await supabase
      .from('nominees')
      .select('*');

    if (nomineesError) {
      nominees = [];
      filteredNominees = [];
      return;
    }

    // Fetch all votes (don't fail if votes fail)
    let votesData = [];
    try {
      const { data: votesResult, error: votesError } = await supabase
        .from('votes')
        .select('nominee_id');
      if (!votesError) {
        votesData = votesResult || [];
      }
    } catch (error) {
      // Continue without votes
    }

    if (nomineesData && nomineesData.length > 0) {
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
      lastFetchTime = now; // Update cache timestamp
      searchCache.clear(); // Clear search cache when data updates
    } else {
      nominees = [];
      filteredNominees = [];
    }
  } catch (error) {
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
    // Check if user has already voted (any nominee)
    const userHasVoted = user && userVotes.size > 0;
    

    
    // Determine button state
    let buttonText = 'Vote';
    let buttonDisabled = false;
    
    if (userHasVoted) {
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

// Super fast search with caching
let searchTimeout;
searchInput.addEventListener('input', e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const q = e.target.value.trim().toLowerCase();
    
    // Check cache first
    if (searchCache.has(q)) {
      filteredNominees = searchCache.get(q);
      currentPage = 1;
      renderNominees();
      return;
    }
    
    if (!q) {
      filteredNominees = nominees;
    } else {
      // Super optimized search
      const results = [];
      for (let i = 0; i < nominees.length; i++) {
        const n = nominees[i];
        const name = n.name?.toLowerCase() || '';
        const city = n.city?.toLowerCase() || '';
        if (name.includes(q) || city.includes(q)) {
          results.push(n);
        }
      }
      filteredNominees = results;
      
      // Cache the result
      searchCache.set(q, results);
    }
    currentPage = 1;
    renderNominees();
  }, DEBOUNCE_DELAY);
});

// Keep form submit for accessibility
searchForm.addEventListener('submit', e => {
  e.preventDefault();
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    filteredNominees = nominees;
  } else {
    filteredNominees = nominees.filter(n => 
      n.name.toLowerCase().includes(q) || 
      (n.city && n.city.toLowerCase().includes(q))
    );
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



// Production-ready utility functions
window.clearSession = async function() {
  try {
    await supabase.auth.signOut();
    user = null;
    userVotes = new Set();
    window.location.reload();
  } catch (error) {
    // Ignore errors
  }
};

// --- Initial Load ---
async function init() {
  try {
    // Handle OAuth callback if returning from sign-in
    const urlParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = urlParams.get('access_token');
    const refreshToken = urlParams.get('refresh_token');
    
    if (accessToken && refreshToken) {
      try {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        if (!error) {
          // Clear the URL hash
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (sessionError) {
        // Ignore session errors
      }
    }
    
    // Check for existing session (but don't require it for viewing)
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        user = session.user;
        
        // Try to get user votes (optional, don't block if it fails)
        try {
          await getUser();
        } catch (error) {
          // Clear user if data fetch fails to prevent issues
          user = null;
          userVotes = new Set();
        }
      }
    } catch (sessionError) {
      // Clear any corrupted session data
      user = null;
      userVotes = new Set();
    }
    
    // Fetch countdown date (no auth required)
    try {
      await fetchCountdownDate();
    } catch (error) {
      // Use fallback countdown
    }
    
    // Fetch nominees (no auth required)
    try {
      await fetchNominees();
    } catch (error) {
      nominees = [];
      filteredNominees = [];
    }
    
    searchInput.value = '';
    filteredNominees = nominees;
    renderNominees();
    
    // Start countdown timer
    setInterval(updateCountdown, 1000);
    
  } catch (error) {
    // Don't show error message, just continue with empty state
    nominees = [];
    filteredNominees = [];
    renderNominees();
  }
}

init(); 