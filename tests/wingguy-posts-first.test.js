/**
 * Posts first - the profile block hands Wingguy their recent posts BEFORE the About.
 *
 * Johnidy Ong, 26 Sep 2026: three posts were read ("recent posts: 3 found") and a long About was read
 * first. The draft hooked on "20+ years across financial services, public sector and telco" and parked
 * a post that was the network idea in his own words ("big programs start with the right people in the
 * room"). What the model reads first gets the weight, so the order is pinned here. The words that go
 * with it live in the store (foundation profile-hook-craft v4, Guy's frac post-connection-message v4).
 *
 * What it cannot check: whether a given draft picks the right post. Only a real draft can - and the
 * chat now says which post it used or passed on, so a miss is visible.
 *
 * Run: node tests/wingguy-posts-first.test.js
 */
const assert = require('assert');
const { buildProfileBlock } = require('../routes/wingguyRoutes');

const block = buildProfileBlock({
  name: 'Johnidy Ong',
  headline: 'Enabling Smart Agile Autonomous Enterprise IT Systems',
  about: '20+ years architecting enterprise IT across financial services, public sector and telco.',
  recentPosts: ['Big successful programs rarely start with all the answers - they start with the right people in the room.'],
});

const postsAt = block.indexOf('Recent posts / featured');
const aboutAt = block.indexOf('About (their own words)');
assert.ok(postsAt >= 0, 'posts are in the block');
assert.ok(aboutAt >= 0, 'About is in the block');
assert.ok(postsAt < aboutAt, 'posts come before the About');
assert.ok(block.includes('right people in the room'), 'the post text itself is carried');
console.log('  ✓ posts come before the About');

// The hook check rides WITH the posts - a rule in the rulebook alone lost to the CV (Johnidy retry).
const checkAt = block.indexOf('HOOK CHECK');
assert.ok(checkAt > postsAt && checkAt < aboutAt, 'hook check sits under the posts, above the About');
assert.ok(/never from years of experience/.test(block), 'hook check rules out the CV tally');
assert.ok(/which post you used/.test(block), 'hook check asks the chat to name the post');
console.log('  ✓ hook check sits right under the posts');

const noPosts = buildProfileBlock({ name: 'Sam', about: 'Builds psychological safety into teams.' });
assert.ok(!noPosts.includes('Recent posts'), 'no posts line when there are no posts');
assert.ok(!noPosts.includes('HOOK CHECK'), 'no hook check when there are no posts');
assert.ok(noPosts.includes('About (their own words)'), 'About still rendered on its own');
console.log('  ✓ no posts - About alone, no empty posts heading');

console.log('\nALL PASS');
