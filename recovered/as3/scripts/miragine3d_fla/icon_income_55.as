package miragine3d_fla
{
   import flash.display.MovieClip;
   import flash.events.DataEvent;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol199")]
   public dynamic class icon_income_55 extends MovieClip
   {
      
      public function icon_income_55()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      internal function frame1() : *
      {
         dispatchEvent(new DataEvent("tips",true,false,"<font color=\'#ffffff\'>收入: 每出一个士兵都会增加收入,每个回合结束的时候收入会变成金币转入你的账户.</font>"));
      }
   }
}

