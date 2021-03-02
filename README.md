# petio

<p align="center"><img src="https://img.shields.io/github/package-json/v/petio-team/petio/master?label=Latest">
<img src="https://img.shields.io/github/package-json/v/petio-team/petio/preview?label=Preview">
<img src="https://img.shields.io/github/package-json/v/petio-team/petio/dev?label=Development"></p>

<p align="center"><a href="https://discord.gg/bseGmrUd3N" target="_blank"><img src="https://img.shields.io/discord/722180802871427104?label=Discord"></a></p>

Request, review and discover companion app for plex.

Allow your users to interact with media both on and off your server with this app. Available as a docker image and also as binaries. Features a React frontend utilizing Redux and a Node JS express API and MongoDb database.

<h2>Get Started</h2>

<h4>1. Instalation</h4>
This application can be installed to run in docker or as a standalone binary that can be configured to run as a service. See our docs below for guides on different setup methods.

<a target="_blank" href="https://github.com/petio-team/petio-docs/wiki/Docker">Docker installation</a> 

Binary (executable file) guides
**note:** this method requires a local mongodb instance to be installed
<a target="_blank" href="https://github.com/petio-team/petio-docs/wiki/Windows">Windows</a> 
<a target="_blank" href="https://github.com/petio-team/petio-docs/wiki/Linux">Linux</a> 
<a target="_blank" href="https://github.com/petio-team/petio-docs/wiki/MacOS">MacOS</a> 

<h4>2. Configuring Petio</h4>
Configuring Petio is fairly straight forward but our docs cover the process, from initial server conenction to email / Sonarr / Radarr.
<a target="_blank" href="https://github.com/petio-team/petio-docs/wiki/Configuration">How to configure Petio</a>

Read our install instructions and then visit `http://localhost:7777/admin/` to begin the setup wizard.

To build from source run `make run` requires node 14 or higher

<h2>Frequently Asked Questions</h2>

<h2>Credits</h2>

<h2>License</h2>

This application is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more details.

This application is no way endorsed by Plex, TheMovieDb, IMDb or any other third party resources utilized within this application.
