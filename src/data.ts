// Class for handling the fetch of repo and color data, be it from cache or the API
// Allows the content script to be agnostic as to where the data is coming from as this class will use promises

const CACHE_THRESHOLD = 36e5; // 1 hour

interface ICachedData {
  cachedAt : number;
  data : object;
}

interface IAPIRepoData {
  language: string;
}

export class Data {
  public repoDataFromCache : boolean = false;
  private username : string;

  constructor(username : string) {
    this.username = username;
  }

  public getData(): Promise<object[]> {
    // Gets both the color data and repo data and returns a Promise that will resolve to get both of them
    // Calling .then on this should get back an array of two values; color and repo data respectively
    return Promise.all([this.getColorData(), this.getRepoData()]);
  }

  private getColorData() : Promise<JSON> {
    const url = chrome.runtime.getURL('colors.json');
      return fetch(url).then((response) => response.json() );
  }

  private checkCache() : Promise<ICachedData> {
    // Create a promise to retrieve the key from cache, or reject if it's not there
    return new Promise((resolve, reject) => {
        reject(); // Temp turn off caching for debugging issues
      chrome.storage.local.get([this.username], (result) => {
        // If the data isn't there, result will be an empty object
        if (Object.keys(result).length > 0) {
          // We have a cached object, so check time of cache
          const cachedData = result[this.username];
          if (new Date().valueOf() - cachedData.cachedAt < CACHE_THRESHOLD) {
            // We can use the cached version
            resolve(cachedData);
          }
        }
        // If we get to this point, there was nothing in cache or the cache was invalid
        reject();
      });
    });
  }

  // Fetches the repo data either from cache or from the API and returns a Promise for the data
  private getRepoData() : Promise<object> {
    // Check if the user's data is in the cache
    return Promise.resolve(
      this.checkCache().then((cachedData) => {
        this.repoDataFromCache = true;
        return Promise.resolve(cachedData.data);
      }).catch(() => {
        // Data wasn't in cache so get new data
        return this.fetchRepoData();
      }),
    );
  }

  private updateRepoData(repoData : object, json : IAPIRepoData[]) : object {
    for (const repo of json) {
      if (repo.language === null) { continue; }
      let count = repoData[repo.language] || 0;
      count++;
      repoData[repo.language] = count;
    }
    return repoData;
  }

  // Helper method to get the next url to go to
  private getNextUrlFromHeader(header : string) {
    const regex = /\<(.*)\>/;
    // The header can contain many URLs, separated by commas, each with a rel
    // We want only the one that contains rel="next"
    for (const url of header.split(', ')) {
      console.log('checking url', url);
      if (url.includes('rel="next"')) {
        // We need to retrive the actual URL part using regex
        return regex.exec(url)[1];
      }
    }
    return null;
  }

  // Fetch repository data from the API
  private async fetchRepoData() : Promise<object> {
    let url = `https://api.github.com/users/${this.username}/repos?page=1&per_page=10`;
    let linkHeader : string;
    let repoData: object = {};
    const headerRegex = /\<(.*)\>; rel="next"/;
    // Use Promise.resolve to wait for the result
    console.log('sending first request');
    let data = await fetch(url).then((response) => {
      linkHeader = response.headers.get('link');
      return response.json()
    });
    console.log('after first request call');
    console.log('link header', linkHeader);
    // From this JSON response, compile repoData (to reduce memory usage) and then see if there's more to fetch
    repoData = this.updateRepoData(repoData, data);
    // Now loop through the link headers, fetching more data and updating the repos dict
    url = this.getNextUrlFromHeader(linkHeader);
    while (url !== null) {
      console.log(url);
      // Send a request and update the repo data again
      data = await fetch(url).then((response) => {
        linkHeader = response.headers.get('link');
        return response.json()
      });
      repoData = this.updateRepoData(repoData, data);
      url = this.getNextUrlFromHeader(linkHeader);
    }
    // Still gonna return a promise
    return Promise.resolve(repoData);
  }
}
