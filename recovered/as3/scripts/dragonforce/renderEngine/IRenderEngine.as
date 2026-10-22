package dragonforce.renderEngine
{
   import dragonforce.core.Camera;
   import dragonforce.core.Scene;
   
   public interface IRenderEngine
   {
      
      function renderScene(param1:Scene, param2:Camera) : void;
   }
}

