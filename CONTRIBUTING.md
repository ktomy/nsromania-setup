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

Before running the project in dev environment make sure to generate the prisma client:
``` 
npx prisma generate
```

To run the project, in the VS Code terminal type
```
pnpm run dev
```
Open http://localhost:3000/

Use test credentials (not available if built in production environment):
* Email: `test@test.com`
* Password: `test`

### Storybook

After the project is installed the Storybook dev environment should be installed with it.
```
pnpm run storybook
```

This will create a web server on the default port 6006 
http://localhost:6006

Make sure to create/update stories when creating a new component or editing an existing one.