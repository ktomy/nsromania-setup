# THe project welcomes contributions

### How to set up the environment

Prerequirements:
* Visual Studio Code
* Docker

Steps to run the application:

Clone the repository through VS Code or by
```
git clone https://github.com/ktomy/nsromania-setup.git
```

Open the cloned repository
Accept to switch to Dev Container
Wait for the containers creation and post-creation scripts to finish execution

Copy the example environment variables to the main environment file: in the VS Code terminal type
```
cp .env.example .env
```

To run the project, in the VS Code terminal type
```
pnpm run dev
```
Open http://localhost:3000/

Use test credentials (not available if built in production environment):
* Email: `test@test.com`
* Password: `test`