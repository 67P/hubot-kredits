const fetch = require('node-fetch');

module.exports = class GiteaReviews {

  token = null;
  kreditsAmounts = null;
  pageLimit = 100;

  constructor (token, kreditsAmounts) {
    this.token = token;
    this.kreditsAmounts = kreditsAmounts;
  }

  async request (path) {
    return fetch(
      `https://gitea.kosmos.org/api/v1${path}`,
      {
        headers: {
          'accepts': 'application/json',
          'Authorization': `token ${this.token}`
        }
      }
    ).then(response => response.json());
  }

  async getReviewContributions (repos, startDate, endDate) {
    let reviewContributions = {}

    await Promise.all(repos.map(async (repo) => {
      let page = 1;
      let result;

      do {
        try {
          result = await this.request(`/repos/${repo}/pulls?state=closed&limit=${this.pageLimit}&page=${page}`);
        } catch(error) {
          console.log(`failed to fetch PRs for repo ${repo}:`, error.message);
          continue;
        }

        if (!result || result.length === 0) {
          continue;
        }

        let pullRequests = result.filter(pr => {
          if (!pr.merged) return false; // only interested in merged PRs

          // check if the PR has been merged in the given timeframe
          const mergeDate = new Date(pr.merged_at);
          if (mergeDate < startDate || mergeDate > endDate) return false;

          // check if the PR has a kredits label
          return pr.labels.some(label => label.name.match(/kredits-[123]/));
        });

        await Promise.all(pullRequests.map(async (pr) => {
          let reviews;
          try {
            reviews = await this.request(`/repos/${repo}/pulls/${pr.number}/reviews`);
          } catch(error) {
            console.log(`failed to fetch reviews for repo ${repo}, PR ${pr.number}:`, error.message);
            return;
          }

          if (!reviews || reviews.length === 0) {
            return;
          }

          reviews = reviews.filter(review => {
            return ['APPROVED', 'REJECTED'].includes(review.state);
          });

          reviews.forEach(review => {
            if (typeof reviewContributions[review.user.login] === 'undefined') {
              reviewContributions[review.user.login] = [];
            }

            let kreditsLabel = pr.labels.find(label => label.name.match(/kredits-[123]/));

            reviewContributions[review.user.login].push({
              pr,
              prNumber: pr.number,
              review,
              reviewState: review.state,
              kredits: this.kreditsAmounts[kreditsLabel.name]
            });
          });
        }));

        page++;
      } while (result && result.length > 0);
    }));

    return reviewContributions;
  }

}
