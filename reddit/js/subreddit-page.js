import * as api from './api.js';
import * as utils from './utils.js';
import { initSubredditPage } from '../../shared/subreddit-page.js';

initSubredditPage({ api, utils, isNsfwSite: false });
