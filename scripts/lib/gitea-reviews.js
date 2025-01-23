const axios = require('axios');

module.exports = class GiteaReviews {

  client = null;
  kreditsAmounts = null;
  pageLimit = 50;

  constructor (token, kreditsAmounts) {
    this.kreditsAmounts = kreditsAmounts;

    this.client = axios.create({
      baseURL: 'https://gitea.kosmos.org/api/v1',
      headers: {
        'accepts': 'application/json',
        'Authorization': `token ${token}`
      }
    });
  }

  async getReviewContributions (repos, startDate, endDate) {
    let pulls = [];
    let reviewContributions = {}

    await Promise.all(repos.map(async (repo) => {
      let page = 1;
      let result;

      do {
        try {
          result = await this.client.get(`/repos/${repo}/pulls?state=closed&limit=${this.pageLimit}&page=${page}`);
        } catch(error) {
          console.log(`failed to fetch PRs for repo ${repo}:`, error.message);
          continue;
        }

        if (!result || !result.data || result.data.length === 0) {
          continue;
        }

        let pullRequests = result.data.filter(pr => {
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
            reviews = await this.client.get(`/repos/${repo}/pulls/${pr.number}/reviews`);
          } catch(error) {
            console.log(`failed to fetch reviews for repo ${repo}, PR ${pr.number}:`, error.message);
            return;
          }

          if (!reviews || !reviews.data || reviews.data.length === 0) {
            return;
          }

          reviews = reviews.data.filter(review => {
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
      } while (result && result.data && result.data.length > 0);
    }));

    return reviewContributions;
  }

}
